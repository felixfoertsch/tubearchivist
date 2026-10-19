import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { VideoResponseType } from '../../api/loader/loadVideoById';
import type { PlaylistType } from '../../api/loader/loadPlaylistById';
import loadPlaylistList from '../../api/loader/loadPlaylistList';
import updateWatchedState from '../../api/actions/updateWatchedState';
import queueReindex from '../../api/actions/queueReindex';
import deleteVideo from '../../api/actions/deleteVideo';
import updateDownloadQueueStatusById from '../../api/actions/updateDownloadQueueStatusById';
import updateCustomPlaylist from '../../api/actions/updateCustomPlaylist';
import getApiUrl from '../../configuration/getApiUrl';
import { playerMediaUrl, playerPlaylistChange } from '../lib/player';
import useIsAdmin from '../../functions/useIsAdmin';
import Routes from '../routes';
import { Button } from '../ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../ui/alert-dialog';
import { Card, CardContent } from '../ui/card';

function check(response: { status: number; error?: { error: string } }) {
  if (response.status < 200 || response.status >= 300 || response.error)
    throw new Error(response.error?.error ?? `Request failed (${response.status})`);
}

export default function VideoActions({
  video,
  onRefresh,
}: {
  video: VideoResponseType;
  onRefresh: () => void;
}) {
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const [deleted, setDeleted] = useState(false);
  const [reindexed, setReindexed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [playlists, setPlaylists] = useState<PlaylistType[]>([]);
  const [playlistError, setPlaylistError] = useState('');
  const [showPlaylists, setShowPlaylists] = useState(false);
  const run = async (action: () => Promise<void>, refresh = true) => {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      await action();
      if (refresh) onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Request failed');
    } finally {
      setPending(false);
    }
  };
  const loadPlaylists = async () => {
    if (pending) return;
    setPending(true);
    setPlaylistError('');
    setShowPlaylists(true);
    try {
      const response = await loadPlaylistList({ type: 'custom' });
      check(response);
      setPlaylists(response.data?.data ?? []);
    } catch (cause) {
      setPlaylistError(cause instanceof Error ? cause.message : 'Could not load playlists');
    } finally {
      setPending(false);
    }
  };
  const togglePlaylist = (playlist: PlaylistType) =>
    run(async () => {
      const exists = playlist.playlist_entries.some(entry => entry.youtube_id === video.youtube_id);
      await playerPlaylistChange(
        async () => {
          check(
            await updateCustomPlaylist(
              exists ? 'remove' : 'create',
              playlist.playlist_id,
              video.youtube_id,
            ),
          );
        },
        onRefresh,
        async () => {
          const response = await loadPlaylistList({ type: 'custom' });
          check(response);
          setPlaylists(response.data?.data ?? []);
          setPlaylistError('');
        },
        () =>
          setPlaylistError(
            'Playlist edit saved. Picker could not reload; retry loading playlists.',
          ),
      );
    }, false);
  const removeAndMaybeIgnore = async (ignore: boolean) =>
    run(async () => {
      if (!deleted) {
        check(await deleteVideo(video.youtube_id));
        setDeleted(true);
      }
      if (ignore) check(await updateDownloadQueueStatusById(video.youtube_id, 'ignore-force'));
      navigate(Routes.Channel(video.channel.channel_id));
    }, false);
  return (
    <Card className="py-4">
      <CardContent className="flex flex-wrap items-center gap-2">
        <Button
          variant={video.player.watched ? 'secondary' : 'default'}
          disabled={pending}
          onClick={() =>
            run(async () =>
              check(
                await updateWatchedState({
                  id: video.youtube_id,
                  is_watched: !video.player.watched,
                }),
              ),
            )
          }
        >
          {video.player.watched ? 'Mark unwatched' : 'Mark watched'}
        </Button>
        <Button variant="default" asChild>
          <a download href={playerMediaUrl(video.media_url, getApiUrl())}>
            Download file
          </a>
        </Button>
        {isAdmin && (
          <Button
            variant="outline"
            aria-expanded={showPlaylists}
            disabled={pending}
            onClick={loadPlaylists}
          >
            Playlists
          </Button>
        )}
        {isAdmin && (
          <Button
            variant="default"
            disabled={pending || reindexed}
            onClick={() =>
              run(async () => {
                check(await queueReindex([video.youtube_id], 'video'));
                setReindexed(true);
              }, false)
            }
          >
            {reindexed ? 'Reindex scheduled' : 'Reindex'}
          </Button>
        )}
        {isAdmin && (
          <AlertDialog
            open={confirmDelete}
            onOpenChange={open => {
              if (!pending) setConfirmDelete(open);
            }}
          >
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={pending}>
                Delete video
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent
              aria-labelledby="delete-video-title"
              aria-describedby="delete-video-description"
            >
              <AlertDialogHeader>
                <AlertDialogTitle id="delete-video-title">Delete video?</AlertDialogTitle>
                <AlertDialogDescription id="delete-video-description">
                  Delete {video.title} ({video.youtube_id}) from archive. This cannot be undone.
                  Delete and ignore also prevents future downloads.
                </AlertDialogDescription>
              </AlertDialogHeader>
              {deleted && (
                <p role="status">
                  Video deleted. Retry Delete and ignore to finish ignoring, or choose Delete to
                  leave.
                </p>
              )}
              {error && (
                <p role="alert" className="text-sm text-foreground">
                  {error}
                </p>
              )}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={pending}
                  onClick={event => {
                    event.preventDefault();
                    void removeAndMaybeIgnore(false);
                  }}
                >
                  Delete
                </AlertDialogAction>
                <AlertDialogAction
                  variant="destructive"
                  disabled={pending}
                  onClick={event => {
                    event.preventDefault();
                    void removeAndMaybeIgnore(true);
                  }}
                >
                  Delete and ignore
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        {isAdmin && showPlaylists && (
          <div className="basis-full space-y-2">
            <div className="flex justify-between">
              <h3 className="font-semibold">Custom playlists</h3>
              <Button variant="ghost" size="sm" onClick={() => setShowPlaylists(false)}>
                Close
              </Button>
            </div>
            {playlistError ? (
              <p role="alert">
                {playlistError}{' '}
                <Button variant="default" onClick={loadPlaylists}>
                  Retry
                </Button>
              </p>
            ) : (
              playlists.map(playlist => (
                <Button
                  key={playlist.playlist_id}
                  variant={
                    playlist.playlist_entries.some(entry => entry.youtube_id === video.youtube_id)
                      ? 'destructive'
                      : 'default'
                  }
                  disabled={pending}
                  onClick={() => togglePlaylist(playlist)}
                >
                  {playlist.playlist_entries.some(entry => entry.youtube_id === video.youtube_id)
                    ? 'Remove from'
                    : 'Add to'}{' '}
                  {playlist.playlist_name}
                </Button>
              ))
            )}
            <Link className="text-foreground underline" to={Routes.Playlists}>
              Create playlist
            </Link>
          </div>
        )}
        {error && (
          <p role="alert" className="basis-full text-sm text-foreground">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
