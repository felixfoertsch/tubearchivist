from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("task", "0002_notificationurl")]
    operations = [
        migrations.CreateModel(
            name="JobState",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("task_id", models.CharField(max_length=64, unique=True)),
                ("name", models.CharField(max_length=128)),
                ("status", models.CharField(default="PENDING", max_length=16)),
                ("result", models.TextField(blank=True, null=True)),
                ("traceback", models.TextField(blank=True, null=True)),
                ("date_done", models.DateTimeField(blank=True, null=True)),
                (
                    "command",
                    models.CharField(blank=True, max_length=16, null=True),
                ),
                ("progress", models.JSONField(blank=True, null=True)),
            ],
            options={"ordering": ["-date_done", "-pk"]},
        ),
    ]
