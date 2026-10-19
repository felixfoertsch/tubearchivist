import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import loadVideoById, { type VideoResponseType } from '../../api/loader/loadVideoById';
import loadPlaylistById from '../../api/loader/loadPlaylistById';
import updateWatchedState from '../../api/actions/updateWatchedState';
import { useAppSettingsStore } from '../../stores/AppSettingsStore';
import Routes from '../routes';
import VideoPlayer from './VideoPlayer';
import GoogleCast from './GoogleCast';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';

type Props = { videoId: string | null };
export default function EmbeddableVideoPlayer({ videoId }: Props) {
  const [, setQuery] = useSearchParams();
  const { appSettingsConfig } = useAppSettingsStore();
  const [video, setVideo] = useState<VideoResponseType>();
  const [playlists, setPlaylists] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision(value => value + 1);
  useEffect(() => {
    if (!videoId) return;
    let active = true;
    const load = async () => {
      await Promise.resolve();
      if (!active) return;
      setError('');
      setPlaylists([]);
      try {
        const response = await loadVideoById(videoId);
        if (response.error || response.status < 200 || response.status >= 300 || !response.data)
          throw new Error('Video unavailable.');
        if (!active) return;
        setVideo(response.data);
        const results = await Promise.all(
          (response.data.playlist ?? []).map(id => loadPlaylistById(id)),
        );
        if (results.some(result => result.error || result.status < 200 || result.status >= 300))
          throw new Error('Playlist context unavailable.');
        if (active)
          setPlaylists(
            results.flatMap(result =>
              result.data?.playlist_subscribed
                ? [{ id: result.data.playlist_id, name: result.data.playlist_name }]
                : [],
            ),
          );
      } catch (error) {
        if (active) setError(error instanceof Error ? error.message : 'Video unavailable.');
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [videoId, revision]);
  if (!videoId) return null;
  const current = video?.youtube_id === videoId ? video : undefined;
  return (
    <Card className="mb-6">
      <CardContent className="space-y-4 p-4">
        <div className="flex justify-end">
          <Button
            variant="outline"
            onClick={() =>
              setQuery(params => {
                const next = new URLSearchParams(params);
                next.delete('videoId');
                return next;
              })
            }
          >
            Close player
          </Button>
        </div>
        {error && (
          <div role="alert">
            <p>{error}</p>
            <Button variant="default" onClick={refresh}>
              Retry
            </Button>
          </div>
        )}
        {!current && !error && <p role="status">Loading video…</p>}
        {current && (
          <>
            <VideoPlayer video={current} embed autoplay onWatchStateChanged={refresh} />
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant={current.player.watched ? 'secondary' : 'default'}
                disabled={pending}
                onClick={async () => {
                  setPending(true);
                  setError('');
                  try {
                    const response = await updateWatchedState({
                      id: current.youtube_id,
                      is_watched: !current.player.watched,
                    });
                    if (response.error || response.status < 200 || response.status >= 300)
                      throw new Error();
                    refresh();
                  } catch {
                    setError('Watched state could not be updated. Retry action.');
                  } finally {
                    setPending(false);
                  }
                }}
              >
                {pending ? 'Saving…' : current.player.watched ? 'Mark unwatched' : 'Mark watched'}
              </Button>
              {appSettingsConfig.application.enable_cast && (
                <GoogleCast video={current} setRefresh={refresh} onWatchStateChanged={refresh} />
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {current.stats.view_count.toLocaleString()} views
              {Boolean(current.stats.like_count) &&
                ` · ${current.stats.like_count.toLocaleString()} likes`}
              {current.stats.dislike_count > 0 &&
                appSettingsConfig.downloads.integrate_ryd &&
                ` · ${current.stats.dislike_count.toLocaleString()} dislikes`}
            </p>
            <Link
              className="block font-medium hover:underline"
              to={Routes.Channel(current.channel.channel_id)}
            >
              {current.channel.channel_name}
            </Link>
            {playlists.map(item => (
              <Link
                key={item.id}
                className="block text-sm hover:underline"
                to={Routes.Playlist(item.id)}
              >
                {item.name}
              </Link>
            ))}
            <h2 className="text-xl font-semibold">
              <Link className="hover:underline" to={Routes.Video(current.youtube_id)}>
                {current.title}
              </Link>
            </h2>
          </>
        )}
      </CardContent>
    </Card>
  );
}
