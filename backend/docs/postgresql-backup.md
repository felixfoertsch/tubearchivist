# PostgreSQL backups

**Local development only. Not DockerMan deployment instructions.**

Web restore is disabled. Existing Elasticsearch ZIP/JSON archives cannot restore PostgreSQL and must not be submitted to restore endpoint.

Create a native custom-format backup through admin backup UI or in container:

```sh
docker compose exec tubearchivist python manage.py shell -c 'from appsettings.src.backup import PostgreSQLBackup; PostgreSQLBackup(reason="manual").create_backup()'
```

Backup files live in `/cache/backup/ta_backup-YYYYMMDDTHHMMSSZ-{auto,manual,update}.dump`. Automatic backups honor configured `run_backup` rotation count after successful creation; manual and update backups are never rotated. Protect dumps as database data.

Restore requires stopping TubeArchivist web, all Procrastinate workers, and scheduler, plus a verified database backup/rollback plan. Then:

```sh
docker compose stop tubearchivist
# Ensure no other application replicas, Procrastinate workers, or scheduler remain.
docker compose run --rm --no-deps tubearchivist python manage.py ta_restore_backup ta_backup-YYYYMMDDTHHMMSSZ-manual.dump --target-database tubearchivist --quiesced
```

Bootstrap administrator must preinstall `pg_trgm` in every target database. Dumps exclude this administrator-owned extension so restricted app role can restore without dropping it.

Command requires PostgreSQL 18 server and client, exact configured target database, native dump signature, valid archive, and zero other connected database clients before mutation. Restore runs in one transaction and aborts on first error. The dump includes Procrastinate queue state; stopped workers may resume restored pending jobs after restart, so review expected at-least-once effects before bringing workers up. Never run restore from a live web request or job. Restart application only after successful restore and validation.
