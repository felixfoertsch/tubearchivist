import { useConfirm } from '../components/useConfirm';
import { useEffect, useState } from 'react';
import useIsAdmin from '../../functions/useIsAdmin';
import type { ScheduleResponseType } from '../../api/loader/loadSchedule';
import type { AppriseNotificationType } from '../../api/loader/loadAppriseNotification';
import { requestJson, objectData, settingsError } from '../lib/settings';
import { schedulePayload, scheduleConfig, scheduleTimestamp } from '../lib/settingsSchedule';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { NativeSelect } from '../ui/native-select';

const tasks = [
  ['update_subscribed', 'Rescan subscriptions'],
  ['download_pending', 'Start downloads'],
  ['check_reindex', 'Refresh metadata'],
  ['thumbnail_check', 'Thumbnail check'],
  ['run_backup', 'Database backup'],
] as const;

function ScheduleEditor({
  name,
  title,
  current,
  refresh,
}: {
  name: string;
  title: string;
  current?: ScheduleResponseType[number];
  refresh: () => void;
}) {
  const { confirm, dialog } = useConfirm();
  const [schedule, setSchedule] = useState(current?.schedule || '');
  const configKey =
    name === 'check_reindex' ? 'days' : name === 'run_backup' ? 'rotate' : undefined;
  const [number, setNumber] = useState(configKey ? String(current?.config?.[configKey] ?? '') : '');
  // Reset drafts when the server returns refreshed values.
  const [shown, setShown] = useState(current);
  if (shown !== current) {
    setShown(current);
    setSchedule(current?.schedule || '');
    setNumber(configKey ? String(current?.config?.[configKey] ?? '') : '');
  }
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  async function mutate(remove = false, configOnly = false) {
    if (pending) return;
    const endpoint = `/api/task/schedule/${name}/`;
    setPending(true);
    setError('');
    setSaved('');
    try {
      if (
        remove &&
        !(await confirm({
          title: `Delete ${title} schedule?`,
          description: 'This disables this scheduled task.',
          actionLabel: 'Delete',
        }))
      )
        return;
      const body = remove
        ? undefined
        : JSON.stringify(
            configOnly && configKey ? scheduleConfig(configKey, number) : schedulePayload(schedule),
          );
      await requestJson(endpoint, {
        method: remove ? 'DELETE' : 'POST',
        body,
      });
      setSaved(remove ? 'Schedule deleted.' : 'Schedule saved.');
      refresh();
    } catch (error) {
      setError(settingsError(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <Card className="gap-3 p-4">
      {dialog}
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground">
        Current: {current ? `${current.schedule} (${current.schedule_human})` : 'Disabled'}
        {current && (
          <span className="block">Last run: {scheduleTimestamp(current.last_run_at)}</span>
        )}
      </p>
      {name === 'run_backup' && (
        <p className="text-sm">
          Creates native PostgreSQL database backups. Retention applies only to automatic backups
          after successful creation; manual and update backups are kept.
        </p>
      )}
      <form
        onSubmit={event => {
          event.preventDefault();
          void mutate();
        }}
        className="space-y-3"
      >
        <label className="grid gap-1 text-sm" htmlFor={`${name}-schedule`}>
          Schedule
          <Input
            id={`${name}-schedule`}
            value={schedule}
            onChange={e => setSchedule(e.target.value)}
            placeholder="0 15 * or auto"
            required
          />
        </label>
        {configKey && (
          <label className="grid gap-1 text-sm" htmlFor={`${name}-config`}>
            {configKey === 'days'
              ? 'Refresh metadata older than days (recommended 90)'
              : 'Maximum automatic backups to keep'}
            <Input
              id={`${name}-config`}
              type="number"
              min="0"
              step="1"
              value={number}
              onChange={e => setNumber(e.target.value)}
            />
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="default" disabled={pending} type="submit">
            {pending ? 'Saving…' : 'Save schedule'}
          </Button>
          {configKey && (
            <Button
              variant="default"
              type="button"
              disabled={pending || !current}
              onClick={() => void mutate(false, true)}
            >
              Save {configKey === 'days' ? 'refresh age' : 'backup retention'}
            </Button>
          )}
          {current && (
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={() => void mutate(true)}
            >
              Delete schedule
            </Button>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-foreground">
            {error}
          </p>
        )}
        {saved && (
          <p role="status" className="text-sm">
            {saved}
          </p>
        )}
      </form>
    </Card>
  );
}

function Scheduler() {
  const { confirm, dialog } = useConfirm();
  const [schedules, setSchedules] = useState<ScheduleResponseType>();
  const [notifications, setNotifications] = useState<AppriseNotificationType>();
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [task, setTask] = useState('update_subscribed');
  const [url, setUrl] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      requestJson<unknown>('/api/task/schedule/', { signal: controller.signal }),
      requestJson<unknown>('/api/task/notification/', { signal: controller.signal }),
    ])
      .then(([schedule, notification]) => {
        if (
          !Array.isArray(schedule) ||
          !schedule.every(
            item =>
              item &&
              typeof item.name === 'string' &&
              typeof item.schedule === 'string' &&
              typeof item.schedule_human === 'string' &&
              (item.last_run_at === null || typeof item.last_run_at === 'string') &&
              item.config &&
              !Array.isArray(item.config) &&
              typeof item.config === 'object' &&
              ['days', 'rotate'].every(
                key =>
                  item.config[key] === undefined ||
                  (Number.isSafeInteger(item.config[key]) && item.config[key] >= 0),
              ),
          )
        )
          throw new Error('Invalid schedules returned by server.');
        const records = objectData(notification);
        if (
          !Object.values(records).every(
            item =>
              item &&
              typeof item === 'object' &&
              'urls' in item &&
              Array.isArray(item.urls) &&
              item.urls.every(url => typeof url === 'string') &&
              'title' in item &&
              typeof item.title === 'string',
          )
        )
          throw new Error('Invalid notification settings returned by server.');
        if (!controller.signal.aborted) {
          setSchedules(schedule);
          setNotifications(records);
          setError('');
        }
      })
      .catch(error => {
        if (!controller.signal.aborted) setError(settingsError(error));
      });
    return () => controller.abort();
  }, [revision]);
  async function notificationAction(
    action: 'save' | 'test' | 'delete',
    taskName = task,
    target = url,
  ) {
    if (pending) return;
    const body = JSON.stringify({ task_name: taskName, url: target });
    setPending(true);
    setError('');
    setMessage('');
    try {
      if (
        action === 'delete' &&
        !(await confirm({
          title: 'Delete notification destination?',
          description: `Remove destination for task ${taskName}.`,
          actionLabel: 'Delete',
        }))
      )
        return;
      if (!target.trim()) throw new Error('Enter an Apprise notification URL.');
      const result = await requestJson<unknown>(
        `/api/task/notification/${action === 'test' ? 'test/' : ''}`,
        {
          method: action === 'delete' ? 'DELETE' : 'POST',
          body,
        },
      );
      if (action === 'test') {
        const response = objectData(result);
        if (typeof response.success !== 'boolean' || typeof response.message !== 'string')
          throw new Error('Invalid notification test result.');
        if (!response.success) throw new Error(response.message);
        setMessage(response.message);
      } else {
        setMessage(action === 'save' ? 'Notification saved.' : 'Notification deleted.');
        setRevision(value => value + 1);
      }
    } catch (error) {
      setError(settingsError(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      {dialog}
      <p className="text-sm text-muted-foreground">
        Cron format: minute hour weekday. Example: 0 15 * runs daily at 15:00; auto uses server
        defaults. Minutes must be one integer; schedules cannot run more than once per hour. Cron
        weekday 0 means Sunday.
      </p>
      {error && (
        <p role="alert" className="text-foreground">
          {error}
        </p>
      )}
      <Button variant="outline" onClick={() => setRevision(value => value + 1)}>
        Reload server settings
      </Button>
      {!schedules ? (
        <p role="status">Loading scheduling settings…</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {tasks.map(([name, title]) => (
            <ScheduleEditor
              key={name}
              name={name}
              title={title}
              current={schedules.find(item => item.name === name)}
              refresh={() => setRevision(value => value + 1)}
            />
          ))}
        </div>
      )}
      {notifications && (
        <Card className="gap-3 p-4">
          <h3 className="font-semibold">Task notifications</h3>
          <p className="text-sm">
            Apprise sends notifications when tasks complete. Destination URLs may contain
            credentials.
          </p>
          <Button variant="outline" aria-expanded={revealed} onClick={() => setRevealed(!revealed)}>
            {revealed ? 'Hide destinations' : 'Reveal destinations'}
          </Button>
          {Object.entries(notifications).flatMap(([name, entry]) =>
            entry.urls.map((destination, index) => (
              <div
                key={`${name}-${index}`}
                className="flex flex-wrap items-center gap-2 rounded-lg border p-2 text-sm"
              >
                <span className="min-w-0 flex-1 break-all">
                  {entry.title}: {revealed ? destination : '••••••••'}
                </span>
                <Button
                  variant="destructive"
                  disabled={pending}
                  onClick={() => void notificationAction('delete', name, destination)}
                >
                  Delete
                </Button>
              </div>
            )),
          )}
          <form
            className="space-y-3"
            onSubmit={event => {
              event.preventDefault();
              void notificationAction('save');
            }}
          >
            <label className="grid gap-1 text-sm" htmlFor="notification-task">
              Completed task
              <NativeSelect
                id="notification-task"
                value={task}
                onChange={e => setTask(e.target.value)}
              >
                {[...tasks.slice(0, 3), ['extract_download', 'Add to download queue']].map(
                  ([name, title]) => (
                    <option key={name} value={name}>
                      {title}
                    </option>
                  ),
                )}
              </NativeSelect>
            </label>
            <label className="grid gap-1 text-sm" htmlFor="notification-url">
              Apprise notification URL
              <Input
                id="notification-url"
                type={revealed ? 'text' : 'password'}
                autoComplete="off"
                value={url}
                required
                onChange={e => setUrl(e.target.value)}
              />
            </label>
            <div className="flex gap-2">
              <Button variant="default" disabled={pending} type="submit">
                {pending ? 'Working…' : 'Save notification'}
              </Button>
              <Button
                variant="default"
                type="button"
                disabled={pending || !url}
                onClick={() => void notificationAction('test')}
              >
                Send test
              </Button>
            </div>
          </form>
          {message && <p role="status">{message}</p>}
        </Card>
      )}
    </>
  );
}
export default function SettingsScheduling() {
  const admin = useIsAdmin();
  return admin ? <Scheduler /> : null;
}
