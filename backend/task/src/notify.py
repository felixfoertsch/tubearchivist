"""send notifications using apprise"""

import apprise
from task.models import NotificationURL
from task.src.task_config import TASK_CONFIG
from task.src.task_manager import TaskManager


class Notifications:
    """store task notification destinations"""

    def __init__(self, task_name: str):
        self.task_name = task_name

    def send(self, task_id: str, task_title: str) -> None:
        """send notifications"""
        apobj = apprise.Apprise()
        urls: list[str] = self.get_urls()
        if not urls:
            return

        title, body = self._build_message(task_id, task_title)

        if not body:
            return

        for url in urls:
            apobj.add(url)

        apobj.notify(body=body, title=title)

    def test(self, url) -> tuple[bool, str]:
        """send test notification"""
        try:
            apobj = apprise.Apprise()

            if not apobj.add(url):
                success = False
                message = f"Invalid notification URL format: {url}"
                return success, message

            title = f"[TA] {self.task_name} process ended with SUCCESS"
            body = "This is a test notification. Task completed successfully."

            result = apobj.notify(body=body, title=title)

            if result:
                success = True
                message = "Test notification sent successfully"
                return success, message

            success = False
            message = (
                "Notification failed. "
                "Please check container logs for more information."
            )
            return success, message

        except Exception as err:  # pylint: disable=broad-exception-caught
            success = False
            message = f"Notification error: {str(err)}"
            return success, message

    def _build_message(
        self, task_id: str, task_title: str
    ) -> tuple[str, str | None]:
        """build message to send notification"""
        task = TaskManager().get_task(task_id)
        status = task.get("status")
        title: str = f"[TA] {task_title} process ended with {status}"
        body: str | None = task.get("result")

        return title, body

    def get_urls(self) -> list[str]:
        """get stored urls for task"""
        return list(
            NotificationURL.objects.filter(task_name=self.task_name)
            .order_by("pk")
            .values_list("url", flat=True)
        )

    def add_url(self, url: str) -> None:
        """add url to task notification"""
        NotificationURL.objects.get_or_create(
            task_name=self.task_name, url=url
        )

    def remove_url(self, url: str) -> tuple[dict, int]:
        """remove url from task"""
        deleted, _ = NotificationURL.objects.filter(
            task_name=self.task_name, url=url
        ).delete()
        return {"deleted": deleted}, 200

    def remove_task(self) -> tuple[dict, int]:
        """remove all notifications from task"""
        deleted, _ = NotificationURL.objects.filter(
            task_name=self.task_name
        ).delete()
        return {"deleted": deleted}, 200


def get_all_notifications() -> dict[str, dict[str, object]]:
    """get all notifications stored"""
    notifications: dict[str, dict[str, object]] = {}
    for task_id in (
        NotificationURL.objects.order_by("task_name")
        .values_list("task_name", flat=True)
        .distinct()
    ):
        notifications[task_id] = {
            "urls": list(
                NotificationURL.objects.filter(task_name=task_id)
                .order_by("pk")
                .values_list("url", flat=True)
            ),
            "title": TASK_CONFIG[task_id]["title"],
        }
    return notifications
