"""Isolate unmanaged Procrastinate state alongside Django test databases."""

import pytest


@pytest.fixture(autouse=True)
def empty_worker_queue(request):
    marker = request.node.get_closest_marker("django_db")
    if marker is None or not marker.kwargs.get("transaction", False):
        return
    request.getfixturevalue("transactional_db")
    from django.db import connection

    def clear():
        # Django flush/rollback does not clean unmanaged worker tables after
        # transactional tests. Stale jobs otherwise run in unrelated tests.
        with connection.cursor() as cursor:
            cursor.execute(
                "TRUNCATE procrastinate_jobs, procrastinate_workers CASCADE"
            )

    clear()
    request.addfinalizer(clear)
