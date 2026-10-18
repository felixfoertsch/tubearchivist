import { useConfirm } from '../components/useConfirm';
import { useEffect, useState } from 'react';
import type { BackupListType } from '../../api/loader/loadBackupList';
import useIsAdmin from '../../functions/useIsAdmin';
import { requestJson, settingsError } from '../lib/settings';
import { backupDate } from '../lib/settingsBackup';
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
        <Button type="submit" variant={danger ? 'outline' : 'secondary'} disabled={pending}>
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
  const [backups, setBackups] = useState<BackupListType>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState('');
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    requestJson<unknown>('/api/appsettings/backup/', { signal: controller.signal })
      .then(value => {
        if (
          !Array.isArray(value) ||
          !value.every(
            item =>
              item &&
              typeof item.filename === 'string' &&
              typeof item.timestamp === 'string' &&
              typeof item.reason === 'string',
          )
        )
          throw new Error('Invalid backup list returned by server.');
        if (!controller.signal.aborted) {
          setBackups(value);
          setError('');
        }
      })
      .catch(error => {
        if (!controller.signal.aborted) setError(settingsError(error));
      });
    return () => controller.abort();
  }, [revision]);
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
        <Action
          title="Start ZIP backup"
          help="Export index to cache/backup. ZIP backups are slow and consistency is not guaranteed; prefer snapshots. Ensure no other tasks are running."
          endpoint="/api/appsettings/backup/"
        />
        <Action
          title="Rescan filesystem"
          help="Scan media folder for missing files and remove their metadata from index. This can delete metadata."
          endpoint="/api/appsettings/rescan-filesystem/"
          options
          danger
        />
      </div>
      <Card className="gap-3 p-4">
        <h3 className="font-semibold">Restore ZIP backup</h3>
        <p className="text-sm">
          Restore replaces current index with selected backup from cache/backup.
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
        {!backups ? (
          <p role="status">Loading backups…</p>
        ) : backups.length === 0 ? (
          <p>No backups found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Available ZIP backups</caption>
              <thead>
                <tr>
                  <th className="p-2">Filename</th>
                  <th className="p-2">Timestamp</th>
                  <th className="p-2">Source</th>
                  <th className="p-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {backups.map(backup => (
                  <tr key={backup.filename} className="border-t">
                    <td className="max-w-64 break-all p-2">{backup.filename}</td>
                    <td className="whitespace-nowrap p-2">{backupDate(backup.timestamp)}</td>
                    <td className="p-2">{backup.reason}</td>
                    <td className="p-2">
                      <Button
                        variant="outline"
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
                                title: `Restore ${filename}?`,
                                description: 'This replaces your existing index.',
                                actionLabel: 'Restore',
                              }))
                            )
                              return;
                            await requestJson(endpoint, { method: 'POST' });
                            setMessage('Restore queued. See task progress below.');
                          } catch (error) {
                            setError(settingsError(error));
                          } finally {
                            setPending('');
                          }
                        }}
                      >
                        {pending === backup.filename ? 'Queuing…' : 'Restore'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
export default function SettingsActions() {
  const admin = useIsAdmin();
  return admin ? <Actions /> : null;
}
