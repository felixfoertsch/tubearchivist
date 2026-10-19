import { Collection, CollectionImage, CollectionItem } from '../components/Collection';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import loadVideoById, { type VideoResponseType } from '../../api/loader/loadVideoById';
import loadVideoNav, { type VideoNavResponseType } from '../../api/loader/loadVideoNav';
import loadSimilarVideosById from '../../api/loader/loadSimilarVideosById';
import loadCommentsbyVideoId, {
  type CommentsResponseType,
} from '../../api/loader/loadCommentsbyVideoId';
import { useAppSettingsStore } from '../../stores/AppSettingsStore';
import getApiUrl from '../../configuration/getApiUrl';
import updateWatchedState from '../../api/actions/updateWatchedState';
import deleteVideoProgressById from '../../api/actions/deleteVideoProgressById';
import { Progress } from '../ui/progress';
import type { ApiResponseType } from '../../functions/APIClient';
import Routes from '../routes';
import VideoPlayer from '../components/VideoPlayer';
import VideoDetails from '../components/VideoDetails';
import VideoActions from '../components/VideoActions';
import Comments from '../components/Comments';
import GoogleCast from '../components/GoogleCast';
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
} from '../ui/alert-dialog';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { playerMediaUrl } from '../lib/player';
import { isoDate } from '../videoMetadata';

function dataOrThrow<T>(response: ApiResponseType<T>): T | undefined {
  if (response.error || response.status < 200 || response.status >= 300)
    throw new Error(response.error?.error ?? `Request failed (${response.status}).`);
  return response.data;
}

export default function Video() {
  const { videoId } = useParams<{ videoId: string }>();
  const navigate = useNavigate();
  const { appSettingsConfig } = useAppSettingsStore();
  const [video, setVideo] = useState<VideoResponseType>();
  const [nav, setNav] = useState<VideoNavResponseType[]>([]);
  const [similar, setSimilar] = useState<VideoResponseType[]>([]);
  const [comments, setComments] = useState<CommentsResponseType>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [revision, setRevision] = useState(0);
  const [similarPending, setSimilarPending] = useState(false);
  const [clearProgressTarget, setClearProgressTarget] = useState<string | null>(null);
  const [clearProgressError, setClearProgressError] = useState('');
  const clearProgressTrigger = useRef<HTMLButtonElement | null>(null);
  const mutateSimilar = async (operation: () => Promise<ApiResponseType<unknown>>) => {
    setSimilarPending(true);
    try {
      dataOrThrow(await operation());
      setErrors(previous => {
        const next = { ...previous };
        delete next['similar video action'];
        return next;
      });
      refresh();
    } catch {
      setErrors(previous => ({
        ...previous,
        'similar video action': 'Action failed. Retry using video action button.',
      }));
    } finally {
      setSimilarPending(false);
    }
  };
  const [seek, setSeek] = useState<number>();
  const [autoplayPlaylist, setAutoplayPlaylist] = useState(() =>
    localStorage.getItem('playlistAutoplay') === 'true'
      ? (localStorage.getItem('playlistIdForAutoplay') ?? '')
      : '',
  );
  const refresh = () => setRevision(value => value + 1);

  useEffect(() => {
    clearProgressTrigger.current = null;
    setClearProgressTarget(null);
    setClearProgressError('');
  }, [videoId]);

  useEffect(() => {
    if (!videoId) return;
    let active = true;
    setVideo(previous => (previous?.youtube_id === videoId ? previous : undefined));
    setNav([]);
    setSimilar([]);
    setComments([]);
    setErrors({});
    setSeek(undefined);
    const load = async <T,>(
      key: string,
      loader: () => Promise<ApiResponseType<T>>,
      setter: (data: T) => void,
    ) => {
      try {
        const value = dataOrThrow(await loader());
        if (value === undefined) throw new Error('Empty response.');
        if (active) setter(value);
      } catch (error) {
        if (active)
          setErrors(previous => ({
            ...previous,
            [key]: error instanceof Error ? error.message : 'Request failed. Retry.',
          }));
      }
    };
    void load('video', () => loadVideoById(videoId), setVideo);
    void load('playlist navigation', () => loadVideoNav(videoId), setNav);
    void load('similar videos', () => loadSimilarVideosById(videoId), setSimilar);
    void load('comments', () => loadCommentsbyVideoId(videoId), setComments);
    return () => {
      active = false;
    };
  }, [videoId, revision]);

  useEffect(() => {
    localStorage.setItem('playlistAutoplay', String(Boolean(autoplayPlaylist)));
    localStorage.setItem('playlistIdForAutoplay', autoplayPlaylist);
  }, [autoplayPlaylist]);

  const current = video?.youtube_id === videoId ? video : undefined;
  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-6">
      {Object.entries(errors).map(([key, error]) => (
        <div key={key} role="alert" className="rounded-lg border border-destructive p-4">
          <p>
            Could not load {key}: {error}
          </p>
          <Button variant="default" onClick={refresh}>
            Retry
          </Button>
        </div>
      ))}
      {!current && !errors.video && <p role="status">Loading video…</p>}
      {current && (
        <>
          <title>{`TA | ${current.title}`}</title>
          <VideoPlayer
            video={current}
            seekToTimestamp={seek}
            setSeekToTimestamp={setSeek}
            autoplay={Boolean(autoplayPlaylist)}
            onWatchStateChanged={refresh}
            onVideoEnd={() => {
              const next = nav.find(item => item.playlist_meta.playlist_id === autoplayPlaylist)
                ?.playlist_next?.youtube_id;
              if (next && !errors['playlist navigation']) navigate(Routes.Video(next));
            }}
          />
          {autoplayPlaylist && errors['playlist navigation'] && (
            <p role="alert">
              Autoplay unavailable: playlist navigation failed. Retry loading above or disable
              autoplay.
            </p>
          )}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{current.title}</h1>
            {appSettingsConfig.application.enable_cast && (
              <GoogleCast video={current} setRefresh={refresh} onWatchStateChanged={refresh} />
            )}
          </div>
          <VideoDetails
            key={`details-${current.youtube_id}`}
            video={current}
            onSeek={setSeek}
            onRefresh={refresh}
          />
          <VideoActions key={`actions-${current.youtube_id}`} video={current} onRefresh={refresh} />
          {nav.map(item => (
            <Card key={item.playlist_meta.playlist_id}>
              <CardHeader>
                <CardTitle>
                  <Link
                    className="hover:underline"
                    to={Routes.Playlist(item.playlist_meta.playlist_id)}
                  >
                    Playlist [{(item.playlist_meta.current_idx + 1).toLocaleString()}]:{' '}
                    {item.playlist_meta.playlist_name}
                  </Link>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Button
                  variant={
                    autoplayPlaylist === item.playlist_meta.playlist_id ? 'secondary' : 'outline'
                  }
                  aria-pressed={autoplayPlaylist === item.playlist_meta.playlist_id}
                  onClick={() =>
                    setAutoplayPlaylist(value =>
                      value === item.playlist_meta.playlist_id
                        ? ''
                        : item.playlist_meta.playlist_id,
                    )
                  }
                >
                  Autoplay: {autoplayPlaylist === item.playlist_meta.playlist_id ? 'On' : 'Off'}
                </Button>
                <div className="grid gap-4 sm:grid-cols-2">
                  {(['playlist_previous', 'playlist_next'] as const).map(key => {
                    const entry = item[key];
                    return entry ? (
                      <Link
                        key={key}
                        className="flex min-w-0 items-center gap-3 rounded-lg border p-3 hover:bg-accent"
                        to={Routes.Video(entry.youtube_id)}
                      >
                        <img
                          className="aspect-video w-28 rounded object-cover"
                          src={playerMediaUrl(entry.vid_thumb, getApiUrl())}
                          alt=""
                        />
                        <div>
                          <p className="text-sm text-muted-foreground">
                            {key === 'playlist_previous' ? 'Previous' : 'Next'}
                          </p>
                          <p className="font-medium">
                            [{(entry.idx + 1).toLocaleString()}] {entry.title}
                          </p>
                        </div>
                      </Link>
                    ) : (
                      <div key={key} />
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
          {autoplayPlaylist && (
            <Button variant="outline" onClick={() => setAutoplayPlaylist('')}>
              Disable playlist autoplay
            </Button>
          )}
          <section className="space-y-3" aria-label="Similar videos">
            <h2 className="text-xl font-semibold">Similar videos</h2>
            <Collection grid>
              {similar.map(item => (
                <CollectionItem
                  key={item.youtube_id}
                  media={
                    <Link to={Routes.Video(item.youtube_id)} aria-label={`Play ${item.title}`}>
                      <CollectionImage src={playerMediaUrl(item.vid_thumb_url, getApiUrl())} />
                    </Link>
                  }
                  title={
                    <Link to={Routes.Video(item.youtube_id)} title={item.title}>
                      {item.title}
                    </Link>
                  }
                >
                  <Link
                    className="text-sm text-muted-foreground hover:underline"
                    to={Routes.Channel(item.channel.channel_id)}
                  >
                    {item.channel.channel_name}
                  </Link>
                  <p className="text-sm">
                    {item.player.duration_str} · {item.stats.view_count.toLocaleString()} views ·{' '}
                    {item.player.watched ? 'Watched' : 'Unwatched'}
                  </p>
                  <p className="text-sm text-muted-foreground">{isoDate(item.published)}</p>
                  <Progress
                    value={Math.min(100, Math.max(0, item.player.progress || 0))}
                    aria-label="Watch progress"
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      variant={item.player.watched ? 'secondary' : 'default'}
                      disabled={similarPending}
                      onClick={() =>
                        void mutateSimilar(() =>
                          updateWatchedState({
                            id: item.youtube_id,
                            is_watched: !item.player.watched,
                          }),
                        )
                      }
                    >
                      {item.player.watched ? 'Mark unwatched' : 'Mark watched'}
                    </Button>
                    {Boolean(item.player.progress) && (
                      <Button
                        variant="destructive"
                        disabled={similarPending}
                        onClick={event => {
                          clearProgressTrigger.current = event.currentTarget;
                          setClearProgressError('');
                          setClearProgressTarget(item.youtube_id);
                        }}
                      >
                        Delete watch progress
                      </Button>
                    )}
                  </div>
                </CollectionItem>
              ))}
            </Collection>
          </section>
          <section className="space-y-4" aria-label="Comments">
            <h2 className="text-xl font-semibold">
              Comments
              {current.comment_count != null && `: ${current.comment_count.toLocaleString()}`}
            </h2>
            {current.comment_count === 0 && (
              <p className="text-muted-foreground">Video has no comments</p>
            )}
            <Comments comments={comments} onSeek={setSeek} />
          </section>
        </>
      )}
      <AlertDialog
        open={clearProgressTarget !== null}
        onOpenChange={open => {
          if (!open && !similarPending) setClearProgressTarget(null);
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={event => {
            event.preventDefault();
            const trigger = clearProgressTrigger.current;
            if (trigger?.isConnected) trigger.focus();
            clearProgressTrigger.current = null;
          }}
          aria-labelledby="clear-progress-title"
          aria-describedby="clear-progress-description"
        >
          <AlertDialogHeader>
            <AlertDialogTitle id="clear-progress-title">Delete watch progress?</AlertDialogTitle>
            <AlertDialogDescription id="clear-progress-description">
              Delete saved watch progress for video {clearProgressTarget}. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {clearProgressError && (
            <p role="alert" className="text-sm text-foreground">
              {clearProgressError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={similarPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={similarPending}
              onClick={async event => {
                event.preventDefault();
                if (!clearProgressTarget || similarPending) return;
                setSimilarPending(true);
                setClearProgressError('');
                try {
                  dataOrThrow(await deleteVideoProgressById(clearProgressTarget));
                  setClearProgressTarget(null);
                  refresh();
                } catch {
                  setClearProgressError('Watch progress could not be deleted. Retry or cancel.');
                } finally {
                  setSimilarPending(false);
                }
              }}
            >
              {similarPending ? 'Deleting…' : 'Delete watch progress'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
