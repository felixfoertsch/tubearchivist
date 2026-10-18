import { useConfirm } from './useConfirm';
import { useEffect, useRef, useState } from 'react';
import loadNotifications, {
  type NotificationPages,
  type NotificationResponseType,
} from '../../api/loader/loadNotifications';
import APIClient from '../../functions/APIClient';
import { assertTaskNotifications, pollWhileActive } from '../lib/download';
import useIsAdmin from '../../functions/useIsAdmin';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Progress } from '../ui/progress';

type Props = {
  pageName?: NotificationPages | string;
  includeReindex?: boolean;
  update?: boolean;
  onComplete?: () => void;
};

export default function TaskNotifications({
  pageName = 'all',
  includeReindex = false,
  update = true,
  onComplete,
}: Props) {
  const { confirm, dialog } = useConfirm();
  const admin = useIsAdmin();
  const [notifications, setNotifications] = useState<NotificationResponseType>([]);
  const [error, setError] = useState('');
  const [stopping, setStopping] = useState<string>();
  const hasTasks = useRef(false);
  const completeRef = useRef(onComplete);
  useEffect(() => {
    completeRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (!admin || !update) return;
    let active = true;
    const cleanup = pollWhileActive(
      async () => {
        const response = await loadNotifications(pageName as NotificationPages, includeReindex);
        if (response.status < 200 || response.status >= 300 || response.error)
          throw new Error(response.error?.error ?? `Request failed (${response.status})`);
        return assertTaskNotifications(response.data);
      },
      tasks => {
        if (!active) return false;
        setError('');
        setNotifications(tasks);
        if (tasks.length > 0) hasTasks.current = true;
        else if (hasTasks.current) {
          hasTasks.current = false;
          completeRef.current?.();
        }
        return hasTasks.current;
      },
      busy => (busy ? 1000 : 3000),
      caught => {
        if (active)
          setError(caught instanceof Error ? caught.message : 'Could not load task status');
      },
    );
    return () => {
      active = false;
      cleanup();
    };
  }, [admin, pageName, includeReindex, update]);

  const stop = async (id: string, command: 'stop' | 'kill') => {
    if (stopping) return;
    setStopping(`${id}:${command}`);
    setError('');
    try {
      if (
        command === 'kill' &&
        !(await confirm({
          title: 'Force terminate task?',
          description: `Task ${id}: work in progress may remain incomplete.`,
          actionLabel: 'Kill',
        }))
      )
        return;
      const response = await APIClient(`/api/task/by-id/${encodeURIComponent(id)}/`, {
        method: 'POST',
        body: { command },
      });
      if (response.error || response.status < 200 || response.status >= 300)
        throw new Error(response.error?.error ?? `Request failed (${response.status})`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not stop task');
    } finally {
      setStopping(undefined);
    }
  };

  if (!admin || (!notifications.length && !error && !stopping)) return null;
  return (
    <div className="space-y-2" aria-live="polite">
      {dialog}
      {error && (
        <p role="alert" className="text-sm text-foreground">
          {error}
        </p>
      )}
      {notifications.map(task => (
        <Card key={task.id} className="relative space-y-2 overflow-hidden p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-medium">{task.title}</h2>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {Array.isArray(task.messages) ? task.messages.join('\n') : String(task.messages)}
              </p>
            </div>
            {task.api_stop && task.command !== 'STOP' && task.command !== 'KILL' && (
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={stopping !== undefined}
                  onClick={() => void stop(task.id, 'stop')}
                >
                  {stopping === `${task.id}:stop` ? 'Stopping…' : 'Stop'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={stopping !== undefined}
                  onClick={() => void stop(task.id, 'kill')}
                >
                  {stopping === `${task.id}:kill` ? 'Killing…' : 'Kill'}
                </Button>
              </div>
            )}
          </div>
          <Progress
            value={Math.min(1, Math.max(0, task.progress ?? 0)) * 100}
            aria-label={`${task.title} progress`}
          />
          <p className="text-xs text-muted-foreground">
            {Math.round(Math.min(1, Math.max(0, task.progress ?? 0)) * 100)}%
            {task.level ? ` · ${task.level}` : ''}
          </p>
        </Card>
      ))}
    </div>
  );
}
