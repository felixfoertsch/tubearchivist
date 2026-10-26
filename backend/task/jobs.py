"""Procrastinate task registry and database-backed lifecycle reporting."""

import traceback as traceback_module
from types import SimpleNamespace

from django.db import transaction
from procrastinate.contrib.django import app
from procrastinate.contrib.django.django_connector import DjangoConnector
from procrastinate.exceptions import JobRetry
from procrastinate.manager import JobManager
from procrastinate.retry import RetryStrategy
from task.models import JobState
from task.src.task_config import TASK_CONFIG

SINGLETON_TASKS = {
    "update_subscribed",
    "download_pending",
    "check_reindex",
    "manual_import",
    "run_backup",
    "restore_backup",
    "rescan_filesystem",
    "thumbnail_check",
    "resync_metadata",
    "subscribe_to",
    "index_playlists",
}


@app.task(
    name="task.execute",
    pass_context=True,
    retry=RetryStrategy(max_attempts=3, wait=60, retry_exceptions=(JobRetry,)),
)
def execute(context, task_name: str, args: list, kwargs: dict) -> None:
    """Run one allowlisted task and update TubeArchivist task state."""
    from task.tasks import TASKS

    if (
        task_name not in TASKS
        or not isinstance(args, list)
        or not isinstance(kwargs, dict)
    ):
        raise ValueError("Invalid task payload")
    state, _ = JobState.objects.get_or_create(
        task_id=str(context.job.id),
        defaults={"name": task_name, "status": "STARTED"},
    )
    if state.command == "STOP":
        state.set_status("REVOKED", result="Task stopped before execution")
        from task.src.notify import Notifications

        Notifications(task_name).send(
            state.task_id, TASK_CONFIG[task_name]["title"]
        )
        return
    state.status = "STARTED"
    state.save(update_fields=["status"])
    task = TaskContext(task_name, str(context.job.id), context)
    try:
        result = TASKS[task_name](task, *args, **kwargs)
    except Exception as error:
        from procrastinate.exceptions import JobAborted, JobRetry

        if isinstance(error, JobRetry):
            if context.job.attempts < 3:
                state.status = "RETRY"
                state.save(update_fields=["status"])
            else:
                state.set_status("FAILURE", result="Retry limit reached")
            raise
        if isinstance(error, JobAborted):
            state.set_status("REVOKED", result="Task cancelled")
            return
        if JobState.objects.filter(
            task_id=state.task_id, command="STOP"
        ).exists():
            state.set_status("REVOKED", result="Task stopped")
            return
        state.set_status(
            "FAILURE",
            result=str(error),
            traceback=traceback_module.format_exc(),
        )
        from task.src.notify import Notifications

        Notifications(task_name).send(
            state.task_id, TASK_CONFIG[task_name]["title"]
        )
        raise
    state.refresh_from_db()
    if state.command == "STOP" or state.status == "REVOKED":
        state.set_status("REVOKED", result="Task stopped")
    else:
        state.set_status("SUCCESS", result=result)
    from task.src.notify import Notifications

    Notifications(task_name).send(
        state.task_id, TASK_CONFIG[task_name]["title"]
    )


class TaskContext:
    """Domain task context with Procrastinate cancellation and progress."""

    def __init__(self, name: str, task_id: str, context):
        self.name = name
        self.request = SimpleNamespace(
            id=task_id,
            retries=getattr(getattr(context, "job", None), "attempts", 0),
        )
        self._context = context

    def is_stopped(self) -> bool:
        from django.utils import timezone
        from procrastinate.exceptions import JobAborted

        if self._context.should_abort():
            raise JobAborted
        stopped = JobState.objects.filter(
            task_id=self.request.id,
            command="STOP",
            status__in=["PENDING", "STARTED"],
        ).exists()
        if stopped:
            JobState.objects.filter(task_id=self.request.id).update(
                status="REVOKED", date_done=timezone.now()
            )
        return stopped

    def send_progress(
        self,
        message_lines,
        progress=False,
        title=False,
        level="info",
        youtube_id=None,
    ):
        from common.src.runtime import RuntimeStore

        message, key = self._build_message(level)
        message.update({"messages": message_lines, "progress": progress})
        if title:
            message["title"] = title
        if youtube_id:
            message["youtube_id"] = youtube_id
        RuntimeStore().set_message(key, message, expire=60)
        JobState.objects.filter(task_id=self.request.id).update(
            progress=message
        )

    def _build_message(self, level):
        config = TASK_CONFIG[self.name].copy()
        config.update({"level": level, "id": self.request.id})
        state = JobState.objects.filter(task_id=self.request.id).first()
        if state:
            config["command"] = state.command
        return (
            config,
            f"message:{config.get('group')}:{self.request.id.split('-')[0]}",
        )


async def recover_stalled_jobs():
    """Retry downloads; fail other interrupted jobs without replay."""
    from datetime import timedelta

    from asgiref.sync import sync_to_async
    from common.src.runtime import RuntimeQueue
    from django.utils import timezone
    from procrastinate.jobs import Status

    stalled = await app.job_manager.get_stalled_jobs(task_name="task.execute")
    for job in stalled:
        task_name = job.task_kwargs.get("task_name")
        if task_name == "download_pending" and job.attempts < 3:
            # Domain leases may outlive dead worker's heartbeat.
            await app.job_manager.retry_job_by_id_async(
                job.id,
                timezone.now() + timedelta(seconds=RuntimeQueue.CLAIM_SECONDS),
            )
            await sync_to_async(
                JobState.objects.filter(task_id=str(job.id)).update
            )(status="RETRY")
        else:
            await app.job_manager.finish_job_by_id_async(
                job.id, Status.FAILED, delete_job=False
            )
            state = await sync_to_async(JobState.objects.get)(
                task_id=str(job.id)
            )
            await sync_to_async(state.set_status)(
                "FAILURE", result="Worker interrupted; explicit retry required"
            )


@transaction.atomic
def enqueue_task(task_name: str, *args, **kwargs) -> int:
    """Atomically enqueue allowlisted work and persist its UI task ID."""
    from task.tasks import TASKS

    if task_name not in TASKS:
        raise ValueError(f"Unknown task: {task_name}")
    app.perform_import_paths()
    deferrer = execute.configure(
        lock=f"task:{task_name}" if task_name in SINGLETON_TASKS else None,
    )
    # Worker uses a pool; nested enqueues must join Django's transaction.
    deferrer.job_manager = JobManager(connector=DjangoConnector())
    job_id = deferrer.defer(
        task_name=task_name, args=list(args), kwargs=kwargs
    )
    JobState.objects.create(
        task_id=str(job_id), name=task_name, status="PENDING"
    )
    return job_id
