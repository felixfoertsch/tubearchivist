"""Run PostgreSQL-backed background task worker."""

from django.core.management.base import BaseCommand
from procrastinate.contrib.django import app


class Command(BaseCommand):
    help = "Run the Procrastinate PostgreSQL worker"

    def handle(self, *args, **options):
        import task.jobs  # noqa: F401
        from task.src.schedule import dispatch_schedules

        @app.task(lock="task:maintenance")
        async def dispatch_dynamic_schedules(timestamp: int) -> None:
            """Recover interrupted jobs and dispatch due dynamic schedules."""
            from asgiref.sync import sync_to_async
            from task.jobs import recover_stalled_jobs

            await recover_stalled_jobs()
            await sync_to_async(dispatch_schedules)(timestamp)

        app.periodic(cron="* * * * *")(dispatch_dynamic_schedules)

        @app.task
        def cleanup_task_history(timestamp: int) -> None:
            """Remove completed Procrastinate jobs after 30 days."""
            from datetime import timedelta

            from django.utils import timezone
            from task.models import JobState

            JobState.objects.filter(
                status__in=["SUCCESS", "FAILURE", "REVOKED"],
                date_done__lt=timezone.now() - timedelta(days=30),
            ).delete()
            app.configure_task(
                "builtin:procrastinate.builtin_tasks.remove_old_jobs"
            ).defer(
                max_hours=24 * 30,
                remove_failed=True,
                remove_cancelled=True,
                remove_aborted=True,
            )

        app.periodic(cron="0 3 * * *")(cleanup_task_history)
        with app.replace_connector(app.connector.get_worker_connector()):
            app.run_worker(concurrency=4)
