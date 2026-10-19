import { useConfirm } from './useConfirm';
import { useState } from 'react';
import { isoDate } from '../videoMetadata';
import { Link } from 'react-router-dom';
import deleteDownloadById from '../../api/actions/deleteDownloadById';
import updateDownloadQueueStatusById from '../../api/actions/updateDownloadQueueStatusById';
import NewRoutes from '../routes';
import { Button } from '../ui/button';
import { CollectionImage, CollectionItem } from './Collection';
import type { DownloadRecord } from '../lib/download';
import type { Task } from '../lib/tasks';
import { TaskProgress } from './TaskNotifications';

export function DownloadItem({
  download,
  refresh,
  task,
  grid = false,
}: {
  download: DownloadRecord;
  task?: Task;
  refresh: () => void;
  grid?: boolean;
}) {
  const { confirm, dialog } = useConfirm();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const ignored = download.status === 'ignore';
  const run = async (
    operation: () => Promise<unknown>,
    consent?: { title: string; description: string; actionLabel?: string },
  ): Promise<boolean> => {
    if (pending) return false;
    setPending(true);
    setError('');
    try {
      if (consent && !(await confirm(consent))) return false;
      const result = (await operation()) as { status?: number; error?: { error: string } };
      if (
        result.error ||
        (result.status !== undefined && (result.status < 200 || result.status >= 300))
      )
        throw new Error(result.error?.error ?? `Request failed (${result.status})`);
      refresh();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Update failed');
      return false;
    } finally {
      setPending(false);
    }
  };
  return (
    <CollectionItem
      compact={!grid}
      media={
        <a
          className="shrink-0"
          href={`https://www.youtube.com/watch?v=${encodeURIComponent(download.youtube_id)}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${download.title} on YouTube`}
        >
          <CollectionImage src={download.vid_thumb_url ?? ''} compact={!grid} />
        </a>
      }
      metadata={
        <>
          <div className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
            {download.channel_indexed ? (
              <Link to={NewRoutes.Channel(download.channel_id)}>{download.channel_name}</Link>
            ) : (
              <span>{download.channel_name}</span>
            )}
            <span>{ignored ? 'Ignored' : 'Pending'}</span>
            <span>{download.vid_type}</span>
            {download.auto_start && <span>Auto</span>}
          </div>
        </>
      }
      title={
        <a
          className="font-medium hover:underline"
          href={`https://www.youtube.com/watch?v=${encodeURIComponent(download.youtube_id)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {download.title}
        </a>
      }
      actions={
        <div className="flex flex-wrap gap-1">
          {ignored ? (
            <>
              <Button
                size="sm"
                variant="default"
                disabled={pending}
                onClick={() =>
                  void run(() => updateDownloadQueueStatusById(download.youtube_id, 'pending'))
                }
              >
                Add to queue
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={pending}
                onClick={() => {
                  const id = download.youtube_id;
                  void run(() => deleteDownloadById(id), {
                    title: `Forget ${download.title}?`,
                    description: `Remove ${id} from ignored downloads.`,
                    actionLabel: 'Forget',
                  });
                }}
              >
                Forget
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="destructive"
                disabled={pending}
                onClick={() =>
                  void run(() => updateDownloadQueueStatusById(download.youtube_id, 'ignore'))
                }
              >
                Ignore
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={pending}
                onClick={() => {
                  const id = download.youtube_id;
                  void run(() => updateDownloadQueueStatusById(id, 'ignore-force'), {
                    title: `Force-ignore ${download.title}?`,
                    description: `${id} will not be downloaded automatically.`,
                    actionLabel: 'Force ignore',
                  });
                }}
              >
                Force ignore
              </Button>
              <Button
                size="sm"
                variant="default"
                disabled={pending}
                onClick={() =>
                  void run(() => updateDownloadQueueStatusById(download.youtube_id, 'priority'))
                }
              >
                Download now
              </Button>
            </>
          )}
          {download.message && (
            <Button
              size="sm"
              variant="destructive"
              disabled={pending}
              onClick={() => {
                const id = download.youtube_id;
                void run(() => deleteDownloadById(id), {
                  title: `Delete ${download.title}?`,
                  description: `Remove ${id} from downloads.`,
                  actionLabel: 'Delete',
                });
              }}
            >
              Delete
            </Button>
          )}
        </div>
      }
    >
      {dialog}
      <p className="text-xs text-muted-foreground">
        {download.published && `${isoDate(download.published)} · `}
        {download.duration} · {download.youtube_id}
      </p>
      {task && <TaskProgress task={task} label={download.title} />}
      {download.message && <p className="text-sm text-foreground">{download.message}</p>}
      {error && (
        <p role="alert" className="text-xs text-foreground">
          {error}
        </p>
      )}
    </CollectionItem>
  );
}
