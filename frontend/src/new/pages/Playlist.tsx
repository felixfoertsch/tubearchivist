import { useConfirm } from '../components/useConfirm';
import { PlayerText } from '../components/Comments';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import NewRoutes from '../routes';
import { currentResult, assertResponse, errorMessage, isoDate } from '../videoMetadata';
import loadPlaylistById from '../../api/loader/loadPlaylistById';
import loadChannelById from '../../api/loader/loadChannelById';
import updateChannelSubscription from '../../api/actions/updateChannelSubscription';
import loadVideoListByFilter, {
  WatchTypesEnum,
  type WatchTypes,
} from '../../api/loader/loadVideoListByPage';
import updatePlaylistSubscription from '../../api/actions/updatePlaylistSubscription';
import deletePlaylist from '../../api/actions/deletePlaylist';
import queueReindex from '../../api/actions/queueReindex';
import updateWatchedState from '../../api/actions/updateWatchedState';
import updatePlaylistSortOrder from '../../api/actions/updatePlaylistSortOrder';
import { useUserConfigStore } from '../../stores/UserConfigStore';
import { useFilterBarTempConf } from '../../stores/FilterbarTempConf';
import { requestedPage, nextPage } from '../pagination';
import useCanManageApp from '../../functions/useCanManageApp';
import { Button } from '../ui/button';
import VideoFilters from '../components/VideoFilters';
import { NativeSelect } from '../ui/native-select';
import { VideoCollection } from '../components/VideoCollection';
import EmbeddableVideoPlayer from '../components/EmbeddableVideoPlayer';

export default function Playlist() {
  const { confirm, dialog } = useConfirm();
  const { playlistId = '' } = useParams();
  const navigate = useNavigate();
  const { userConfig } = useUserConfigStore();
  const { filterHeight } = useFilterBarTempConf();
  const isAdmin = useCanManageApp();
  const [searchParams, setSearchParams] = useSearchParams();

  const page = requestedPage(searchParams.get('page'), userConfig.page_size) ?? 0;
  const videoId = searchParams.get('videoId');
  const [playlist, setPlaylist] = useState<Awaited<ReturnType<typeof loadPlaylistById>>['data']>();
  const [videoResponse, setVideoResponse] =
    useState<Awaited<ReturnType<typeof loadVideoListByFilter>>>();
  const [revision, setRevision] = useState(0);
  const [loadedKey, setLoadedKey] = useState('');
  const requestKey = JSON.stringify([
    playlistId,
    page,
    videoId,
    revision,
    userConfig.hide_watched_playlist,
    userConfig.vid_type_filter,
    filterHeight,
  ]);
  const videos = loadedKey === requestKey ? videoResponse?.data?.data : undefined;
  const [channelResult, setChannelResult] = useState<{
    key: string;
    data: Awaited<ReturnType<typeof loadChannelById>>['data'];
  }>();
  const channel =
    playlist?.playlist_id === playlistId
      ? currentResult(channelResult, playlist.playlist_channel_id)?.data
      : undefined;
  const [loadError, setLoadError] = useState<{ key: string; message: string }>();
  const currentLoadError = currentResult(loadError, requestKey);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [deleteChoice, setDeleteChoice] = useState(false);
  const [scheduled, setScheduled] = useState(false);
  const refresh = () => setRevision(value => value + 1);
  useEffect(() => {
    let active = true;
    void Promise.all([
      loadPlaylistById(playlistId),
      loadVideoListByFilter({
        playlist: playlistId,
        page,
        watch:
          userConfig.hide_watched_playlist == null
            ? null
            : ((userConfig.hide_watched_playlist
                ? WatchTypesEnum.Watched
                : WatchTypesEnum.Unwatched) as WatchTypes),
        type: userConfig.vid_type_filter ?? undefined,
        height: filterHeight,
      }),
    ])
      .then(async ([p, v]) => {
        assertResponse(p);
        assertResponse(v);
        if (!p.data) throw new Error('Playlist response missing data');
        if (!Array.isArray(v.data?.data)) throw new Error('Video response missing data');
        if (active) {
          setPlaylist(p.data);
          setVideoResponse(v);
          setLoadedKey(requestKey);
          setError('');
        }
        if (p.data?.playlist_type !== 'custom') {
          const c = await loadChannelById(p.data?.playlist_channel_id ?? '');
          assertResponse(c);
          if (active) setChannelResult({ key: p.data.playlist_channel_id, data: c.data });
        }
      })
      .catch(caught => {
        if (active)
          setLoadError({
            key: requestKey,
            message: errorMessage(caught, 'Could not load playlist'),
          });
      });
    return () => {
      active = false;
    };
  }, [
    requestKey,
    playlistId,
    page,
    revision,
    userConfig.hide_watched_playlist,
    userConfig.vid_type_filter,
    filterHeight,
    videoId,
  ]);
  const mutate = async (action: () => Promise<{ status: number; error?: { error: string } }>) => {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      assertResponse(await action());
      refresh();
    } catch (caught) {
      setError(errorMessage(caught, 'Playlist update failed'));
    } finally {
      setPending(false);
    }
  };
  if (currentLoadError && playlist?.playlist_id !== playlistId)
    return (
      <section className="space-y-3">
        <h1 className="text-xl font-semibold">Playlist unavailable</h1>
        <p role="alert">{currentLoadError.message}</p>
        <Button variant="default" onClick={refresh}>
          Retry
        </Button>
      </section>
    );
  if (!playlist || playlist.playlist_id !== playlistId)
    return <p role="status">Loading playlist…</p>;
  const custom = playlist.playlist_type === 'custom';
  const entries = playlist.playlist_entries ?? [];
  const archived = entries.filter(video => video.downloaded).length;
  const scheduleReindex = async (videosOnly: boolean) => {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      assertResponse(await queueReindex([playlistId], 'playlist', videosOnly));
      setScheduled(true);
    } catch (caught) {
      setError(errorMessage(caught, 'Reindex failed'));
    } finally {
      setPending(false);
    }
  };
  const remove = async (allVideos: boolean) => {
    if (pending || !isAdmin) return;
    const target = playlistId;
    const name = playlist.playlist_name;
    setPending(true);
    try {
      if (
        !(await confirm({
          title: 'Delete playlist?',
          description: `Delete ${name}${allVideos ? ' and all downloaded videos' : ' metadata'}?`,
          actionLabel: allVideos ? 'Delete all' : 'Delete metadata',
        }))
      )
        return;
      setError('');
      assertResponse(await deletePlaylist(target, allVideos));
      void navigate(NewRoutes.Playlists);
    } catch (caught) {
      setError(errorMessage(caught, 'Playlist deletion failed'));
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="space-y-4">
      {dialog}
      <header className="space-y-2">
        <h1 className="text-xl font-semibold">{playlist.playlist_name}</h1>
        <p className="text-sm text-muted-foreground">
          Last refreshed: {isoDate(playlist.playlist_last_refresh)}
        </p>
        {!custom && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm">
            <Link
              className="font-medium hover:underline"
              to={NewRoutes.Channel(playlist.playlist_channel_id)}
            >
              {channel?.channel_name ?? playlist.playlist_channel}
            </Link>
            {channel?.channel_subs != null && (
              <span className="text-muted-foreground">
                Subscribers: {new Intl.NumberFormat().format(channel.channel_subs)}
              </span>
            )}
            {isAdmin && channel && (
              <Button
                size="sm"
                variant={channel.channel_subscribed ? 'secondary' : 'default'}
                disabled={pending}
                onClick={() =>
                  void mutate(() =>
                    updateChannelSubscription(channel.channel_id, !channel.channel_subscribed),
                  )
                }
              >
                {channel.channel_subscribed ? 'Unsubscribe channel' : 'Subscribe channel'}
              </Button>
            )}
            <span>Playlist {playlist.playlist_subscribed ? 'subscribed' : 'not subscribed'}</span>
            {isAdmin && (
              <Button
                size="sm"
                variant={playlist.playlist_subscribed ? 'secondary' : 'default'}
                disabled={pending}
                onClick={() =>
                  void mutate(() =>
                    updatePlaylistSubscription(playlistId, !playlist.playlist_subscribed),
                  )
                }
              >
                {playlist.playlist_subscribed ? 'Unsubscribe playlist' : 'Subscribe playlist'}
              </Button>
            )}
            <span>
              YouTube:{' '}
              {playlist.playlist_active ? (
                <a
                  href={`https://www.youtube.com/playlist?list=${encodeURIComponent(playlist.playlist_id)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  Active
                </a>
              ) : (
                'Deactivated'
              )}
            </span>
          </div>
        )}
        {playlist.playlist_description !== null && (
          <section className="space-y-2 rounded-lg border p-3">
            <p
              className={`whitespace-pre-wrap text-sm ${descriptionExpanded ? '' : 'line-clamp-4'}`}
            >
              <PlayerText>{playlist.playlist_description}</PlayerText>
            </p>
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={descriptionExpanded}
              onClick={() => setDescriptionExpanded(value => !value)}
            >
              {descriptionExpanded ? 'Show less' : 'Show more'}
            </Button>
          </section>
        )}
      </header>
      {currentLoadError && (
        <p role="alert">
          {currentLoadError.message}{' '}
          <Button variant="default" size="sm" onClick={refresh}>
            Retry
          </Button>
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-foreground">
          {error}
        </p>
      )}
      <section className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm">
        <span>
          Archived videos: {archived}/{entries.length}
        </span>
        {archived > 0 && (
          <>
            <Button
              size="sm"
              variant="default"
              disabled={pending}
              onClick={() =>
                void mutate(() => updateWatchedState({ id: playlistId, is_watched: true }))
              }
            >
              Mark as watched
            </Button>
            <Button
              size="sm"
              variant="default"
              disabled={pending}
              onClick={() =>
                void mutate(() => updateWatchedState({ id: playlistId, is_watched: false }))
              }
            >
              Mark as unwatched
            </Button>
          </>
        )}
        {isAdmin && (
          <>
            {scheduled ? (
              <p role="status">Reindex scheduled</p>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="default"
                  disabled={pending || custom}
                  onClick={() => void scheduleReindex(false)}
                >
                  Reindex playlist
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  disabled={pending}
                  onClick={() => void scheduleReindex(true)}
                >
                  Reindex videos
                </Button>
              </>
            )}
            {!custom && (
              <label className="flex items-center gap-2">
                Sort order{' '}
                <NativeSelect
                  size="sm"
                  disabled={pending}
                  value={playlist.playlist_sort_order}
                  onChange={e =>
                    void mutate(() =>
                      updatePlaylistSortOrder(playlistId, e.target.value as 'top' | 'bottom'),
                    )
                  }
                >
                  <option value="top">Top</option>
                  <option value="bottom">Bottom</option>
                </NativeSelect>
              </label>
            )}
            {!deleteChoice ? (
              <Button
                size="sm"
                variant="destructive"
                disabled={pending}
                onClick={() => setDeleteChoice(true)}
              >
                Delete playlist
              </Button>
            ) : (
              <>
                <span>Delete {playlist.playlist_name}?</span>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={pending}
                  onClick={() => void remove(false)}
                >
                  Delete metadata
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={pending}
                  onClick={() => void remove(true)}
                >
                  Delete all
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDeleteChoice(false)}>
                  Cancel
                </Button>
              </>
            )}
          </>
        )}
      </section>
      <section className="space-y-3">
        <details className="rounded-lg border p-3 text-sm">
          <summary className="cursor-pointer font-medium">
            All playlist entries ({entries.length.toLocaleString()}) · Missing (
            {(entries.length - archived).toLocaleString()})
          </summary>
          <ol className="mt-3 space-y-2">
            {entries.map(entry => (
              <li key={entry.youtube_id} className="flex flex-wrap items-center gap-2">
                <span>{entry.idx.toLocaleString()}.</span>
                {entry.downloaded ? (
                  <Link
                    className="min-w-0 flex-1 hover:underline"
                    to={NewRoutes.Video(entry.youtube_id)}
                  >
                    {entry.title}
                  </Link>
                ) : (
                  <a
                    className="min-w-0 flex-1 hover:underline"
                    href={`https://www.youtube.com/watch?v=${encodeURIComponent(entry.youtube_id)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {entry.title}
                  </a>
                )}
                <span className="text-muted-foreground">
                  {entry.downloaded ? 'Downloaded' : 'Not archived'}
                </span>
              </li>
            ))}
          </ol>
        </details>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Videos ({entries.length})</h2>
        </div>
        <EmbeddableVideoPlayer videoId={videoId} />
        <VideoFilters hideWatched="hide_watched_playlist" showSort={false} showType />
        <VideoCollection
          key={JSON.stringify([
            playlistId,
            userConfig.hide_watched_playlist,
            userConfig.vid_type_filter,
            filterHeight,
          ])}
          videos={videos ?? []}
          refresh={refresh}
          playlistId={playlistId}
          reorder={custom}
          loading={loadedKey !== requestKey}
        />
        {videoResponse && entries.length === 0 && (
          <p>{custom ? 'Add videos from Home.' : 'No videos in this playlist yet.'}</p>
        )}
        <nav aria-label="Pagination" className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            disabled={page <= 1}
            onClick={() =>
              setSearchParams(params => {
                if (page <= 2) params.delete('page');
                else params.set('page', String(page - 1));
                return params;
              })
            }
          >
            Previous
          </Button>
          <span>
            Page{' '}
            {videoResponse?.data && !Array.isArray(videoResponse.data)
              ? videoResponse.data.paginate?.current_page || page || 1
              : page || 1}
          </span>
          <Button
            variant="outline"
            disabled={
              nextPage(
                videoResponse?.data && !Array.isArray(videoResponse.data)
                  ? videoResponse.data.paginate
                  : undefined,
              ) === undefined
            }
            onClick={() =>
              setSearchParams(params => {
                const next = nextPage(
                  videoResponse?.data && !Array.isArray(videoResponse.data)
                    ? videoResponse.data.paginate
                    : undefined,
                );
                if (next !== undefined) params.set('page', String(next));
                return params;
              })
            }
          >
            Next
          </Button>
        </nav>
      </section>
    </div>
  );
}
