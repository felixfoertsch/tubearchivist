"""Transactional tests must not inherit unmanaged jobs from earlier cases."""

import pytest
from django.db import connection
from procrastinate.contrib.django.models import ProcrastinateJob
from task.jobs import enqueue_task

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.mark.parametrize("iteration", range(2))
def test_unmanaged_jobs_do_not_survive_test_boundary(iteration):
    assert not ProcrastinateJob.objects.exists()
    job_id = enqueue_task("manual_import")
    with connection.cursor() as cursor:
        cursor.execute(
            "UPDATE procrastinate_jobs SET status='doing', worker_id=NULL "
            "WHERE id=%s",
            [job_id],
        )
    # Deliberately leave a locked job. Django flush alone preserves it while
    # deleting its JobState; shared fixture must clean both test boundaries.
    assert ProcrastinateJob.objects.get(pk=job_id).status == "doing"
