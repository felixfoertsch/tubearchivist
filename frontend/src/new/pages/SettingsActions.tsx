import { useConfirm } from '../components/useConfirm';
import { useEffect, useState } from 'react';
import type { BackupListType } from '../../api/loader/loadBackupList';
import useCanManageApp from '../../functions/useCanManageApp';
import useIsAdmin from '../../functions/useIsAdmin';
import { requestJson, settingsError } from '../lib/settings';
import { backupDate, validateBackups, downloadBackup } from '../lib/settingsBackup';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Checkbox } from '../ui/checkbox';

function Action({
  title,
  help,
  endpoint,
  options = false,
  danger = false,
}: {
  title: string;
  help: string;
  endpoint: string;
  options?: boolean;
  danger?: boolean;
}) {
  const { confirm, dialog } = useConfirm();
  const [preferLocal, setPreferLocal] = useState(false);
  const [ignoreErrors, setIgnoreErrors] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  return (
    <Card className="gap-3 p-4">
      {dialog}
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground">{help}</p>
      <form
        className="space-y-3"
        onSubmit={async event => {
          event.preventDefault();
          if (pending) return;
          const requestEndpoint = endpoint;
          const body = options
            ? JSON.stringify({ ignore_error: ignoreErrors, prefer_local: preferLocal })
            : undefined;
          setPending(true);
          setError('');
          setMessage('');
          try {
            if (danger && !(await confirm({ title, description: help }))) return;
            await requestJson(requestEndpoint, {
              method: 'POST',
              body,
            });
            setMessage('Task queued. See task progress below.');
          } catch (error) {
            setError(settingsError(error));
          } finally {
            setPending(false);
          }
        }}
      >
        {options && (
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <Checkbox
                checked={preferLocal}
                onCheckedChange={value => setPreferLocal(value === true)}
              />
              Prefer embedded metadata
            </label>
            <label className="flex items-center gap-2">
              <Checkbox
                checked={ignoreErrors}
                onCheckedChange={value => setIgnoreErrors(value === true)}
              />
              Ignore missing metadata errors
            </label>
          </div>
        )}
        <Button type="submit" variant={danger ? 'destructive' : 'default'} disabled={pending}>
          {pending ? 'Queuing…' : title}
        </Button>
        {error && (
          <p role="alert" className="text-sm text-foreground">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
      </form>
    </Card>
  );
}
function Actions() {
  const { confirm, dialog } = useConfirm();
  const admin = useIsAdmin();
  const [backups, setBackups] = useState<BackupListType>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState('');
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!admin) return;
    const controller = new AbortController();
    requestJson<unknown>('/api/appsettings/backup/', { signal: controller.signal })
      .then(value => {
        const backups = validateBackups(value);
        if (!controller.signal.aborted) {
          setBackups(backups);
          setError('');
        }
      })
      .catch(error => {
        if (!controller.signal.aborted) setError(settingsError(error));
      });
    return () => controller.abort();
  }, [admin, revision]);
  return (
    <>
      {dialog}
      <div className="grid gap-4 md:grid-cols-2">
        <Action
          title="Start manual import"
          help="Import files from cache/import. Prefer embedded metadata or ignore missing metadata only when appropriate for your files."
          endpoint="/api/appsettings/manual-import/"
          options
        />
        <Action
          title="Embed metadata into media files"
          help="Embed archive metadata as MP4 tags. This modifies existing media files."
          endpoint="/api/task/by-name/resync_metadata/"
          danger
        />
        {admin && (
          <Action
            title="Create database backup"
            help="Create a native PostgreSQL database backup in cache/backup. Media files are not included. Protect downloaded dumps as sensitive database data."
            endpoint="/api/appsettings/backup/"
          />
        )}
        <Action
          title="Rescan filesystem"
          help="Scan media folder for missing files and remove their metadata from index. This can delete metadata."
          endpoint="/api/appsettings/rescan-filesystem/"
          options
          danger
        />
      </div>
      {admin && (
        <Card className="gap-3 p-4">
          <h3 className="font-semibold">Database backups</h3>
          <p className="text-sm">
            List, download or permanently delete native PostgreSQL database backups. Media files are
            not included. Download checks access first, then starts a browser-managed transfer.
            Check your browser for completion or transfer errors; access or file availability can
            change after the check.
          </p>
          <Button variant="outline" onClick={() => setRevision(value => value + 1)}>
            Reload backups
          </Button>
          {error && (
            <p role="alert" className="text-foreground">
              {error}
            </p>
          )}
          {message && <p role="status">{message}</p>}
          {!backups && !error ? (
            <p role="status">Loading backups…</p>
          ) : !backups ? null : backups.length === 0 ? (
            <p>No backups found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Available database backups</caption>
                <thead>
                  <tr>
                    <th className="p-2">Filename</th>
                    <th className="p-2">Timestamp</th>
                    <th className="p-2">Source</th>
                    <th className="p-2">Size (bytes)</th>
                    <th className="p-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {backups.map(backup => (
                    <tr key={backup.filename} className="border-t">
                      <td className="max-w-64 break-all p-2">{backup.filename}</td>
                      <td className="whitespace-nowrap p-2">{backupDate(backup.timestamp)}</td>
                      <td className="p-2">{backup.reason}</td>
                      <td className="p-2">{backup.file_size.toLocaleString()}</td>
                      <td className="p-2">
                        <Button
                          variant="outline"
                          disabled={!!pending}
                          onClick={async () => {
                            if (pending) return;
                            setPending(backup.filename);
                            setError('');
                            try {
                              await downloadBackup(backup.filename);
                            } catch (error) {
                              setError(settingsError(error));
                            } finally {
                              setPending('');
                            }
                          }}
                        >
                          Download
                        </Button>
                        <Button
                          variant="destructive"
                          disabled={!!pending}
                          onClick={async () => {
                            if (pending) return;
                            const filename = backup.filename;
                            const endpoint = `/api/appsettings/backup/${encodeURIComponent(filename)}/`;
                            setPending(filename);
                            setError('');
                            setMessage('');
                            try {
                              if (
                                !(await confirm({
                                  title: `Delete database backup ${filename}?`,
                                  description:
                                    'Permanently delete this backup file. The running database and media files are unchanged.',
                                  actionLabel: 'Delete',
                                }))
                              )
                                return;
                              await requestJson(endpoint, { method: 'DELETE' });
                              setMessage('Database backup deleted.');
                              setRevision(value => value + 1);
                            } catch (error) {
                              setError(settingsError(error));
                            } finally {
                              setPending('');
                            }
                          }}
                        >
                          {pending === backup.filename ? 'Working…' : 'Delete'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      {admin && (
        <Card className="gap-3 p-4">
          <h3 className="font-semibold">Offline database restore</h3>
          <p>
            Online restore is disabled. Ask the instance operator to arrange maintenance;
            administrator access in this UI does not grant server access.
          </p>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>
              Verify a database backup and rollback plan. Legacy Elasticsearch ZIP/JSON archives
              cannot restore PostgreSQL.
            </li>
            <li>
              Stop all TubeArchivist web replicas, Procrastinate workers and scheduler. Ensure no
              other database clients remain connected.
            </li>
            <li>
              With PostgreSQL 18 server and client, run{' '}
              <code>
                python manage.py ta_restore_backup &lt;filename&gt; --target-database
                &lt;configured-database&gt; --quiesced
              </code>{' '}
              in the application maintenance environment.
            </li>
            <li>
              Validate restored data before restarting. Dumps include queue state; restored pending
              jobs may run again. Review possible repeated effects first.
            </li>
          </ol>
          <p className="text-sm">
            Operator procedure: <code>backend/docs/postgresql-backup.md</code>. Media files require
            a separate backup.
          </p>
        </Card>
      )}
    </>
  );
}
export default function SettingsActions() {
  const canManageApp = useCanManageApp();
  return canManageApp ? <Actions /> : null;
}
