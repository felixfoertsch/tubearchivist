import { useConfirm } from './useConfirm';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleAlert, Download, LoaderCircle } from 'lucide-react';
import loadDownloadQueue from '../../api/loader/loadDownloadQueue';
import APIClient from '../../functions/APIClient';
import { assertDownloadResponse, taskPercent, type DownloadRecord } from '../lib/download';
import { useTaskStore, type Task } from '../lib/tasks';
import NewRoutes from '../routes';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Progress } from '../ui/progress';
import { CollectionImage } from './Collection';

const QUEUE_PREVIEW = 5;

function useTaskStop() {
  const { confirm, dialog } = useConfirm();
  const [stopping, setStopping] = useState<string>();
  const [error, setError] = useState('');
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
  const controls = (task: Task) =>
    task.api_stop &&
    task.command !== 'STOP' &&
    task.command !== 'KILL' && (
      <div className="flex gap-1">
        {(['stop', 'kill'] as const).map(command => (
          <Button
            key={command}
            variant="outline"
            size="sm"
            disabled={stopping !== undefined}
            aria-label={`${command === 'stop' ? 'Stop' : 'Kill'} ${task.title}`}
            onClick={() => void stop(task.id, command)}
          >
            {stopping === `${task.id}:${command}`
              ? command === 'stop'
                ? 'Stopping…'
                : 'Killing…'
              : command === 'stop'
                ? 'Stop'
                : 'Kill'}
          </Button>
        ))}
      </div>
    );
  return { dialog, error, controls };
}

export function TaskProgress({ task, label }: { task: Task; label: string }) {
  const percent = taskPercent(task.progress);
  return (
    <div className="space-y-1">
      <Progress value={percent} aria-label={`${label} progress`} />
      <p className="text-xs text-muted-foreground">
        {percent}% · {task.messages.at(-1)}
      </p>
    </div>
  );
}

// Full task details for the Downloads page. Per-video progress renders on the queue item.
export default function TaskNotifications() {
  const { tasks, error: loadError } = useTaskStore();
  const { dialog, error, controls } = useTaskStop();
  if (!tasks.length && !loadError && !error) return null;
  return (
    <div className="space-y-2" aria-live="polite">
      {dialog}
      {(loadError || error) && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{error || loadError}</AlertDescription>
        </Alert>
      )}
      {tasks.map(task => (
        <Alert
          key={task.id}
          role={task.level === 'error' ? 'alert' : 'status'}
          variant={task.level === 'error' ? 'destructive' : 'default'}
        >
          {task.level === 'error' ? (
            <CircleAlert />
          ) : (
            <LoaderCircle className="motion-safe:animate-spin" />
          )}
          <AlertTitle>{task.title}</AlertTitle>
          <AlertDescription>
            <p className="whitespace-pre-wrap">{task.messages.join('\n')}</p>
            {!task.youtube_id && task.progress !== undefined && (
              <TaskProgress task={task} label={task.title} />
            )}
            {controls(task)}
          </AlertDescription>
        </Alert>
      ))}
    </div>
  );
}

export function TaskIndicator() {
  const { tasks, error: loadError, advanced } = useTaskStore();
  const { dialog, error, controls } = useTaskStop();
  const [open, setOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const key = `${advanced}:${retry}`;
  const [result, setResult] = useState<{
    key: string;
    items?: DownloadRecord[];
    total?: number;
    error?: string;
  }>();
  const queue = result?.key === key ? result : { key };
  useEffect(() => {
    if (!open) return;
    let current = true;
    void loadDownloadQueue(0, null, null, null, false, '')
      .then(raw => {
        const data = assertDownloadResponse(raw);
        if (current)
          setResult({
            key,
            items: data.data.slice(0, QUEUE_PREVIEW),
            total: data.paginate.total_hits,
          });
      })
      .catch(caught => {
        if (current)
          setResult({
            key,
            error: caught instanceof Error ? caught.message : 'Could not load queue',
          });
      });
    return () => {
      current = false;
    };
  }, [open, key]);
  const failed = !!loadError || tasks.some(task => task.level === 'error');
  const active = tasks.find(task => task.youtube_id);
  const label = failed
    ? 'Background tasks: error'
    : tasks.length
      ? `Background tasks: ${tasks.length} running`
      : 'Background tasks: idle';
  return (
    <Popover
      open={open}
      onOpenChange={next => {
        setOpen(next);
        if (next) setRetry(value => value + 1);
      }}
    >
      {dialog}
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={label} title={label}>
          {failed ? (
            <CircleAlert className="text-destructive" />
          ) : tasks.length ? (
            <LoaderCircle className="motion-safe:animate-spin" />
          ) : (
            <Download />
          )}
          {tasks.length > 0 && <span aria-hidden="true">{tasks.length}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3 p-3">
        <section aria-label="Running tasks" className="space-y-2">
          {(loadError || error) && (
            <p role="alert" className="text-sm text-destructive">
              {error || loadError}
            </p>
          )}
          {tasks.length === 0 && !loadError && (
            <p className="text-sm text-muted-foreground">No tasks running.</p>
          )}
          {tasks.map(task => (
            <div key={task.id} className="space-y-1">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium">{task.title}</p>
                {controls(task)}
              </div>
              {task.youtube_id ? (
                <p className="line-clamp-1 text-xs text-muted-foreground">{task.messages[0]}</p>
              ) : (
                <TaskProgress task={task} label={task.title} />
              )}
            </div>
          ))}
        </section>
        <section aria-label="Download queue" className="space-y-2 border-t pt-3">
          <h2 className="text-sm font-medium">
            Up next{queue.total !== undefined ? ` · ${queue.total} queued` : ''}
          </h2>
          {queue.error && (
            <p role="alert" className="text-sm text-destructive">
              {queue.error}{' '}
              <Button variant="outline" size="sm" onClick={() => setRetry(value => value + 1)}>
                Retry
              </Button>
            </p>
          )}
          {!queue.items && !queue.error && (
            <p role="status" className="text-sm text-muted-foreground">
              Loading queue…
            </p>
          )}
          {queue.items?.length === 0 && (
            <p className="text-sm text-muted-foreground">Queue is empty.</p>
          )}
          <ul className="space-y-2">
            {queue.items?.map(item => (
              <li key={item.youtube_id} className="flex gap-2">
                <CollectionImage src={item.vid_thumb_url ?? ''} compact />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="line-clamp-1 text-sm">{item.title}</p>
                  {active && active.youtube_id === item.youtube_id ? (
                    <TaskProgress task={active} label={item.title} />
                  ) : (
                    <p className="line-clamp-1 text-xs text-muted-foreground">
                      {item.channel_name}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <Button variant="outline" size="sm" className="w-full" asChild>
            <Link to={NewRoutes.Downloads} onClick={() => setOpen(false)}>
              See all downloads
            </Link>
          </Button>
        </section>
      </PopoverContent>
    </Popover>
  );
}
