"""PostgreSQL-backed task state and commands."""

from task.models import JobState


class TaskManager:
    """Read task lifecycle state persisted alongside Procrastinate jobs."""

    def get_all_results(self):
        return [self.as_dict(row) for row in JobState.objects.all()]

    def get_tasks_by_name(self, task_name):
        return [
            self.as_dict(row)
            for row in JobState.objects.filter(name=task_name)
        ]

    def get_task(self, task_id):
        row = JobState.objects.filter(task_id=str(task_id)).first()
        return self.as_dict(row) if row else None

    @staticmethod
    def as_dict(row):
        from task.src.task_config import TASK_CONFIG

        config = TASK_CONFIG[row.name]
        progress = row.progress or {}
        message = {
            **config,
            **progress,
            "status": row.status,
            "result": row.result,
            "traceback": row.traceback,
            "date_done": row.date_done.isoformat() if row.date_done else False,
            "name": row.name,
            "task_id": row.task_id,
            "command": row.command,
        }
        return message

    def is_pending(self, task):
        return (
            JobState.objects.filter(
                name=task.name, status__in=["PENDING", "STARTED"]
            )
            .exclude(task_id=task.request.id)
            .exists()
        )

    def is_stopped(self, task_id):
        return JobState.objects.filter(
            task_id=str(task_id),
            command="STOP",
            status__in=["PENDING", "STARTED"],
        ).exists()

    def get_pending(self, task_name):
        return [
            row
            for row in self.get_tasks_by_name(task_name)
            if row["status"] in {"PENDING", "STARTED"}
        ]

    def init(self, task):
        JobState.objects.update_or_create(
            task_id=str(task.request.id),
            defaults={"name": task.name, "status": "STARTED"},
        )

    def fail_pending(self):
        """Leave stale-job recovery to Procrastinate worker heartbeat.

        Procrastinate handles stale jobs through worker heartbeat recovery.
        """
        return None


class TaskCommand:
    """Queue and cancel task jobs."""

    def start(self, task_name, kwargs=None):
        from task.jobs import enqueue_task

        task_id = enqueue_task(task_name, **(kwargs or {}))
        return {
            "task_id": str(task_id),
            "status": "PENDING",
            "task_name": task_name,
        }

    def stop(self, task_id):
        JobState.objects.filter(task_id=str(task_id)).update(command="STOP")
