# Generated for PostgreSQL runtime persistence.
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True
    dependencies = []
    operations = [
        migrations.CreateModel(
            name="RuntimeValue",
            fields=[
                ("key", models.TextField(primary_key=True, serialize=False)),
                ("value", models.TextField()),
                ("expires_at", models.DateTimeField(blank=True, db_index=True, null=True)),
            ],
        ),
        migrations.CreateModel(
            name="RuntimeQueueState",
            fields=[
                ("queue", models.TextField(primary_key=True, serialize=False)),
                ("next_position", models.BigIntegerField(default=1)),
            ],
        ),
        migrations.CreateModel(
            name="QueueEntry",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("queue", models.TextField()),
                ("value", models.TextField()),
                ("position", models.BigIntegerField()),
                ("claimed_until", models.DateTimeField(blank=True, db_index=True, null=True)),
                ("claimed_by", models.UUIDField(blank=True, null=True)),
            ],
            options={
                "indexes": [models.Index(fields=["queue", "position"], name="runtime_queue_position")],
                "constraints": [models.UniqueConstraint(fields=("queue", "value"), name="runtime_queue_value_unique")],
            },
        ),
    ]
