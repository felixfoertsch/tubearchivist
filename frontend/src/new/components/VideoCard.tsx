import { useConfirm } from './useConfirm';
import { CollectionImage, CollectionItem } from './Collection';
import { useState } from 'react';
import NewRoutes from '../routes';
import { Link, useSearchParams } from 'react-router-dom';
import type { VideoType } from '../../pages/Home';
import updateWatchedState from '../../api/actions/updateWatchedState';
import deleteVideoProgressById from '../../api/actions/deleteVideoProgressById';
import updateCustomPlaylist from '../../api/actions/updateCustomPlaylist';
import useIsAdmin from '../../functions/useIsAdmin';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Progress } from '../ui/progress';
import { errorMessage, assertResponse, duration, isoDate, progress } from '../videoMetadata';

export default function VideoCard({
  video,
  refresh,
  compact = false,
  playlistId,
  reorder = false,
  selection,
}: {
  video: VideoType;
  refresh: () => void;
  compact?: boolean;
  playlistId?: string;
  reorder?: boolean;
  selection?: React.ReactNode;
}) {
  const { confirm, dialog } = useConfirm();
  const isAdmin = useIsAdmin();
  const [, setSearchParams] = useSearchParams();
  const playInline: React.MouseEventHandler<HTMLAnchorElement> = event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    setSearchParams(previous => {
      const next = new URLSearchParams(previous);
      next.set('videoId', video.youtube_id);
      next.delete('t');
      return next;
    });
  };
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const run = async (
    action: () => Promise<{ status: number; error?: { error: string } } | undefined>,
  ) => {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      const response = await action();
      if (response) {
        assertResponse(response);
        refresh();
      }
    } catch (caught) {
      setError(errorMessage(caught, 'Update failed'));
    } finally {
      setPending(false);
    }
  };
  const href = NewRoutes.Video(video.youtube_id);
  return (
    <CollectionItem
      compact={compact}
      media={
        <Link
          to={href}
          onClick={playInline}
          aria-label={`Play ${video.title}`}
          className="shrink-0"
        >
          <CollectionImage src={video.vid_thumb_url} compact={compact} />
        </Link>
      }
      title={
        <Link to={href} title={video.title}>
          {video.title}
        </Link>
      }
      metadata={
        <>
          <Link to={NewRoutes.Channel(video.channel.channel_id)}>{video.channel.channel_name}</Link>
          <Badge variant="secondary">{video.vid_type}</Badge>
          <span>{video.player.duration_str || duration(video.player.duration)}</span>
          <time dateTime={video.published}>{isoDate(video.published)}</time>
        </>
      }
      actions={
        <fieldset disabled={pending} className="flex flex-wrap gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void run(() =>
                updateWatchedState({ id: video.youtube_id, is_watched: !video.player.watched }),
              )
            }
          >
            {pending ? 'Saving…' : video.player.watched ? 'Mark unwatched' : 'Mark watched'}
          </Button>
          {video.player.position > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void run(() => deleteVideoProgressById(video.youtube_id))}
            >
              Clear progress
            </Button>
          )}
          {isAdmin &&
            reorder &&
            playlistId &&
            (['top', 'up', 'down', 'bottom', 'remove'] as const).map(action => (
              <Button
                key={action}
                variant="outline"
                size="sm"
                onClick={() => {
                  const targetPlaylist = playlistId;
                  const targetVideo = video.youtube_id;
                  const title = video.title;
                  void run(async () => {
                    if (
                      action === 'remove' &&
                      !(await confirm({
                        title: 'Remove video?',
                        description: `Remove ${title} from playlist?`,
                        actionLabel: 'Remove',
                      }))
                    )
                      return;
                    return updateCustomPlaylist(action, targetPlaylist, targetVideo);
                  });
                }}
              >
                {action === 'remove' ? 'Remove' : `Move ${action}`}
              </Button>
            ))}
        </fieldset>
      }
    >
      {dialog}
      {selection}
      {video.player.position > 0 && (
        <div className="flex min-w-0 max-w-full items-center gap-2 text-xs">
          <Progress
            aria-label={`Watch progress for ${video.title}`}
            value={progress(video.player.position, video.player.duration)}
          />
          <span className="shrink-0">
            {duration(video.player.position)} / {duration(video.player.duration)}
          </span>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-foreground">
          {error}
        </p>
      )}
    </CollectionItem>
  );
}
