from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True
    dependencies = []
    operations = [
        migrations.CreateModel(
            name="CustomPeriodicTask",
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
                ("name", models.CharField(max_length=128, unique=True)),
                ("schedule", models.CharField(max_length=128)),
                ("task_config", models.JSONField(default=dict)),
                ("last_run_at", models.DateTimeField(blank=True, null=True)),
            ],
        ),
    ]
