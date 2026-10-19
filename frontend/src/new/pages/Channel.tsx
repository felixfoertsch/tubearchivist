import { useConfirm } from '../components/useConfirm';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import loadChannelById from '../../api/loader/loadChannelById';
import loadChannelNav from '../../api/loader/loadChannelNav';
import loadChannelAggs from '../../api/loader/loadChannelAggs';
import loadVideoListByFilter, {
  WatchTypesEnum,
  type VideoTypes,
} from '../../api/loader/loadVideoListByPage';
import loadPlaylistList from '../../api/loader/loadPlaylistList';
import updateChannelSubscription from '../../api/actions/updateChannelSubscription';
import updateChannelOverwrites from '../../api/actions/updateChannelOverwrite';
import updateUserConfig from '../../api/actions/updateUserConfig';
import deleteChannel from '../../api/actions/deleteChannel';
import queueReindex, { ReindexTypeEnum } from '../../api/actions/queueReindex';
import updateWatchedState from '../../api/actions/updateWatchedState';
import useIsAdmin from '../../functions/useIsAdmin';
import { useUserConfigStore } from '../../stores/UserConfigStore';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Input } from '../ui/input';
import { NativeSelect } from '../ui/native-select';
import { Textarea } from '../ui/textarea';
import { Checkbox } from '../ui/checkbox';
import type { VideoType } from '../../pages/Home';
import type { PlaylistType } from '../../api/loader/loadPlaylistById';
import VideoCollection from '../components/VideoCollection';
import EmbeddableVideoPlayer from '../components/EmbeddableVideoPlayer';
import PlaylistList from '../components/PlaylistList';
import { PlayerText } from '../components/Comments';
import { useTaskStore } from '../lib/tasks';
import { requestedPage, nextPage } from '../pagination';
import NewRoutes from '../routes';
import { channelNumber, errorMessage, isoDate } from '../videoMetadata';
import { useFilterBarTempConf } from '../../stores/FilterbarTempConf';
import VideoFilters from '../components/VideoFilters';

type ChannelResponse = Awaited<ReturnType<typeof loadChannelById>>;
const assertResponse = (r: { status: number; error?: { error: string } }) => {
  if (r.error || r.status < 200 || r.status >= 300)
    throw new Error(r.error?.error ?? `Request failed (${r.status})`);
};
type Channel = NonNullable<ChannelResponse['data']>;
type PageInfo = import('../../components/Pagination').PaginationType;

export default function Channel() {
  const { channelId = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const videoId = params.get('videoId');
  const { userConfig, setUserConfig } = useUserConfigStore();
  const { filterHeight } = useFilterBarTempConf();
  const admin = Boolean(useIsAdmin());
  const lastSegment = location.pathname.split('/').filter(Boolean).at(-1);
  const tab = ['streams', 'shorts', 'playlist', 'about'].includes(lastSegment ?? '')
    ? lastSegment === 'playlist'
      ? 'playlists'
      : lastSegment
    : 'videos';
  const type = (
    tab === 'streams' ? 'streams' : tab === 'shorts' ? 'shorts' : 'videos'
  ) as VideoTypes;
  const [manualCount, setCount] = useState(0);
  const count = manualCount + useTaskStore(state => state.finished);
  const [channelResult, setChannelResult] = useState<{
    id: string;
    data?: Channel;
    error?: string;
  }>();
  const [nav, setNav] = useState<{
    id: string;
    data?: Awaited<ReturnType<typeof loadChannelNav>>['data'];
  }>();
  const [content, setContent] = useState<{
    key: string;
    videos?: VideoType[];
    playlists?: PlaylistType[];
    pagination?: PageInfo;
    error?: string;
  }>();
  const [aggs, setAggs] = useState<{
    id: string;
    data?: Awaited<ReturnType<typeof loadChannelAggs>>['data'];
  }>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const page = requestedPage(params.get('page'), userConfig.page_size) ?? 1;
  const subscribedPlaylists = userConfig.show_subed_only_playlists;
  const key = JSON.stringify([
    channelId,
    type,
    userConfig.hide_watched_channel,
    filterHeight,
    page,
    tab,
    tab === 'playlists' ? subscribedPlaylists : undefined,
    count,
    videoId,
    tab === 'playlists' ? userConfig.view_style_playlist : undefined,
    userConfig.sort_by,
    userConfig.sort_order,
  ]);
  const channel = channelResult?.id === channelId ? channelResult.data : undefined;
  const refresh = () => setCount(n => n + 1);
  const previousSubscriptionFilter = useRef(subscribedPlaylists);
  useEffect(() => {
    if (previousSubscriptionFilter.current === subscribedPlaylists) return;
    previousSubscriptionFilter.current = subscribedPlaylists;
    setParams(p => {
      p.delete('page');
      return p;
    });
  }, [subscribedPlaylists, setParams]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      loadChannelById(channelId),
      loadChannelNav(channelId),
      loadChannelAggs(channelId),
    ])
      .then(([c, n, a]) => {
        assertResponse(c);
        assertResponse(n);
        assertResponse(a);
        if (!c.data || !n.data) throw new Error('Channel response missing');
        if (active) {
          setChannelResult({ id: channelId, data: c.data });
          setNav({ id: channelId, data: n.data });
          setAggs({ id: channelId, data: a.data });
        }
      })
      .catch(
        e =>
          active &&
          setChannelResult({
            id: channelId,
            error: errorMessage(e, 'Could not load channel'),
          }),
      );
    return () => {
      active = false;
    };
  }, [channelId, count]);

  useEffect(() => {
    if (!channelId || tab === 'about') return;
    let active = true;
    const fetchData = async () => {
      try {
        if (tab === 'playlists') {
          const r = await loadPlaylistList({
            channel: channelId,
            page,
            subscribed: subscribedPlaylists,
          });
          assertResponse(r);
          if (!Array.isArray(r.data?.data)) throw new Error('Playlist response missing');
          if (active)
            setContent({ key, playlists: r.data.data ?? [], pagination: r.data.paginate });
        } else {
          const r = await loadVideoListByFilter({
            channel: channelId,
            page,
            type,
            watch:
              userConfig.hide_watched_channel === null
                ? null
                : userConfig.hide_watched_channel
                  ? (WatchTypesEnum.Watched as 'watched')
                  : (WatchTypesEnum.Unwatched as 'unwatched'),
            sort: userConfig.sort_by,
            order: userConfig.sort_order,
            height: filterHeight,
          });
          assertResponse(r);
          if (!Array.isArray(r.data?.data)) throw new Error('Video or aggregate response missing');
          if (active) {
            setContent({ key, videos: r.data.data ?? [], pagination: r.data.paginate });
          }
        }
      } catch (e) {
        if (active)
          setContent({
            key,
            error: errorMessage(e, 'Could not load channel content'),
          });
      }
    };
    void fetchData();
    return () => {
      active = false;
    };
  }, [
    key,
    channelId,
    tab,
    page,
    type,
    count,
    videoId,
    userConfig.hide_watched_channel,
    userConfig.sort_by,
    userConfig.sort_order,
    subscribedPlaylists,
    userConfig.view_style_playlist,
    userConfig.view_style_channel,
    filterHeight,
  ]);

  const mutate = async (
    operation: () => Promise<{ status: number; error?: { error: string } }>,
    done?: () => void,
  ) => {
    if (pending) return false;
    setPending(true);
    setError('');
    try {
      const r = await operation();
      assertResponse(r);
      done?.();
      refresh();
      return true;
    } catch (e) {
      setError(errorMessage(e, 'Request failed'));
      return false;
    } finally {
      setPending(false);
    }
  };
  if (channelResult?.id === channelId && channelResult.error)
    return <p role="alert">{channelResult.error}</p>;
  if (!channel) return <p>Loading channel…</p>;
  const videos = content?.key === key ? (content.videos ?? []) : [];
  const playlists = content?.key === key ? (content.playlists ?? []) : [];
  const pagination = content?.key === key ? content.pagination : undefined;
  const overwrite = async (field: string, value: string | boolean | number | null) =>
    mutate(() => updateChannelOverwrites(channelId, field, value));
  const tabPath = (name: string) =>
    name === 'streams'
      ? NewRoutes.ChannelStream(channelId)
      : name === 'shorts'
        ? NewRoutes.ChannelShorts(channelId)
        : name === 'playlists'
          ? NewRoutes.ChannelPlaylist(channelId)
          : name === 'about'
            ? NewRoutes.ChannelAbout(channelId)
            : NewRoutes.Channel(channelId);
  const tabs = [
    'videos',
    ...(nav?.id === channelId && nav.data?.has_streams === true ? ['streams'] : []),
    ...(nav?.id === channelId && nav.data?.has_shorts === true ? ['shorts'] : []),
    ...(nav?.id === channelId && nav.data?.has_playlists === true ? ['playlists'] : []),
    'about',
  ];
  return (
    <main className="space-y-4">
      <h1 className="text-xl font-semibold">{channel.channel_name}</h1>
      <img
        className="max-h-64 w-full rounded-lg object-cover"
        src={channel.channel_banner_url || channel.channel_thumb_url}
        alt=""
      />
      <nav aria-label="Channel sections" className="flex flex-wrap gap-2">
        {tabs.map(t => (
          <Button key={t} variant={tab === t ? 'secondary' : 'outline'} asChild>
            <Link to={tabPath(t)}>{t[0].toUpperCase() + t.slice(1)}</Link>
          </Button>
        ))}
        {admin && nav?.data?.has_pending && (
          <Link to={NewRoutes.DownloadsByChannelId(channelId)}>Downloads</Link>
        )}
        {admin && nav?.data?.has_ignored && (
          <Link to={NewRoutes.IgnoredByChannelId(channelId)}>Ignored</Link>
        )}
      </nav>
      {error && <p role="alert">{error}</p>}
      {content?.key === key && content.error && <p role="alert">{content.error}</p>}
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-3">
          <img
            className="size-12 rounded-full object-cover"
            src={channel.channel_thumb_url}
            alt=""
          />
          <span>{channel.channel_subs.toLocaleString()} subscribers</span>
          {admin && (
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                void mutate(() => updateChannelSubscription(channelId, !channel.channel_subscribed))
              }
            >
              {pending ? 'Saving…' : channel.channel_subscribed ? 'Unsubscribe' : 'Subscribe'}
            </Button>
          )}
        </div>
      </Card>
      {tab !== 'about' && (
        <>
          {tab !== 'playlists' && <VideoFilters hideWatched="hide_watched_channel" />}
          {tab === 'playlists' && (
            <Card className="flex flex-wrap items-center gap-3 p-3">
              <label>
                Playlist subscription filter
                <NativeSelect
                  value={subscribedPlaylists === null ? '' : String(subscribedPlaylists)}
                  disabled={pending}
                  onChange={e => {
                    const value = e.target.value === '' ? null : e.target.value === 'true';
                    void mutate(
                      () => updateUserConfig({ show_subed_only_playlists: value }),
                      () => {
                        setUserConfig({ ...userConfig, show_subed_only_playlists: value });
                        setParams(previous => {
                          const next = new URLSearchParams(previous);
                          next.delete('page');
                          return next;
                        });
                      },
                    );
                  }}
                >
                  <option value="">All subscription states</option>
                  <option value="true">Subscribed only</option>
                  <option value="false">Unsubscribed only</option>
                </NativeSelect>
              </label>
              <Button
                variant={userConfig.view_style_playlist === 'grid' ? 'secondary' : 'outline'}
                disabled={pending}
                onClick={() =>
                  void mutate(async () => {
                    const response = await updateUserConfig({ view_style_playlist: 'grid' });
                    assertResponse(response);
                    if (!response.data) throw new Error('Configuration response missing');
                    setUserConfig(response.data);
                    return response;
                  })
                }
              >
                Grid
              </Button>
              <Button
                variant={userConfig.view_style_playlist === 'list' ? 'secondary' : 'outline'}
                disabled={pending}
                onClick={() =>
                  void mutate(async () => {
                    const response = await updateUserConfig({ view_style_playlist: 'list' });
                    assertResponse(response);
                    if (!response.data) throw new Error('Configuration response missing');
                    setUserConfig(response.data);
                    return response;
                  })
                }
              >
                List
              </Button>
            </Card>
          )}
          {tab !== 'playlists' && <EmbeddableVideoPlayer videoId={videoId} />}
          {tab !== 'playlists' && aggs?.id === channelId && aggs.data && (
            <Card className="p-4">
              <p>
                {aggs.data.total_items.value} videos · {aggs.data.total_duration.value_str} playback
                · {new Intl.NumberFormat().format(aggs.data.total_size.value)} bytes
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    void mutate(() => updateWatchedState({ id: channelId, is_watched: true }))
                  }
                >
                  Mark as watched
                </Button>
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    void mutate(() => updateWatchedState({ id: channelId, is_watched: false }))
                  }
                >
                  Mark as unwatched
                </Button>
              </div>
            </Card>
          )}
          {content?.key === key && !content.error && tab === 'playlists' ? (
            <PlaylistList playlists={playlists} refresh={refresh} />
          ) : null}
          {tab !== 'playlists' && (
            <VideoCollection
              key={JSON.stringify([channelId, type, userConfig.hide_watched_channel, filterHeight])}
              videos={videos}
              refresh={refresh}
              view={userConfig.view_style_home}
              loading={content?.key !== key || Boolean(content?.error)}
            />
          )}
          {content?.key !== key && <p>Loading…</p>}
          <nav aria-label="Pagination" className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              disabled={page <= 1}
              onClick={() =>
                setParams(p => {
                  if (page <= 2) p.delete('page');
                  else p.set('page', String(page - 1));
                  return p;
                })
              }
            >
              Previous
            </Button>
            <span>Page {pagination?.current_page || page || 1}</span>
            <Button
              variant="outline"
              disabled={nextPage(pagination) === undefined}
              onClick={() =>
                setParams(p => {
                  const n = nextPage(pagination);
                  if (n !== undefined) p.set('page', String(n));
                  return p;
                })
              }
            >
              Next
            </Button>
          </nav>
        </>
      )}
      {tab === 'about' && aggs?.id === channelId && aggs.data && (
        <Card className="p-3 text-sm">
          <p>
            {aggs.data.total_items.value.toLocaleString()} videos ·{' '}
            {aggs.data.total_duration.value_str} playback ·{' '}
            {aggs.data.total_size.value.toLocaleString()} bytes
          </p>
        </Card>
      )}
      {tab === 'about' && (
        <About
          key={channelId}
          channel={channel}
          admin={admin}
          pending={pending}
          error={error}
          mutate={mutate}
          overwrite={overwrite}
          navigate={navigate}
        />
      )}
    </main>
  );
}

function About({
  channel,
  admin,
  pending: operationPending,
  error,
  mutate,
  overwrite,
  navigate,
}: {
  channel: Channel;
  admin: boolean;
  pending: boolean;
  error: string;
  mutate: (
    operation: () => Promise<{ status: number; error?: { error: string } }>,
    done?: () => void,
  ) => Promise<boolean>;
  overwrite: (field: string, value: string | boolean | number | null) => Promise<boolean>;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const { confirm, dialog } = useConfirm();
  const [confirming, setConfirming] = useState(false);
  const pending = operationPending || confirming;
  const [desc, setDesc] = useState(false);
  const [format, setFormat] = useState(channel.channel_overwrites?.download_format ?? '');
  const [days, setDays] = useState(channel.channel_overwrites?.autodelete_days?.toString() ?? '');
  const [sizes, setSizes] = useState(
    [
      channel.channel_overwrites?.subscriptions_channel_size,
      channel.channel_overwrites?.subscriptions_shorts_channel_size,
      channel.channel_overwrites?.subscriptions_live_channel_size,
    ].map(n => n?.toString() ?? ''),
  );
  const [filter, setFilter] = useState(channel.channel_overwrites?.auto_ignore_filter ?? '');
  const [rolling, setRolling] = useState(
    channel.channel_overwrites?.rolling_window_size?.toString() ?? '',
  );
  const [savedRolling, setSavedRolling] = useState(rolling);
  const [saveMessage, setSaveMessage] = useState('');
  const [sponsor, setSponsor] = useState<boolean | null>(
    channel.channel_overwrites?.integrate_sponsorblock ?? null,
  );
  const [validationError, setValidationError] = useState('');
  const saveNumber = async (key: string, value: string) => {
    try {
      const number = channelNumber(value, key === 'rolling_window_size' ? 1 : 0);
      setValidationError('');
      setSaveMessage('');
      if (await overwrite(key, number)) {
        if (key === 'rolling_window_size') {
          setSavedRolling(number?.toString() ?? '');
          setRolling(number?.toString() ?? '');
        }
        setSaveMessage('Saved');
      }
    } catch (caught) {
      setValidationError(errorMessage(caught, 'Invalid number'));
    }
  };
  return (
    <div className="space-y-4">
      {dialog}
      <Card className="space-y-3 p-4">
        <h2 className="font-semibold">About</h2>
        <p>Last refreshed: {isoDate(channel.channel_last_refresh)}</p>
        <p>
          Channel ID: <code>{channel.channel_id}</code>
        </p>
        <p>
          Youtube:{' '}
          {channel.channel_active ? (
            <a
              href={`https://www.youtube.com/channel/${encodeURIComponent(channel.channel_id)}`}
              target="_blank"
              rel="noreferrer"
            >
              Active
            </a>
          ) : (
            'Deactivated'
          )}
        </p>
        <p className={desc ? '' : 'line-clamp-4'}>
          <PlayerText>{channel.channel_description ?? ''}</PlayerText>
        </p>
        {channel.channel_description && (
          <Button variant="outline" onClick={() => setDesc(v => !v)}>
            {desc ? 'Show less' : 'Show more'}
          </Button>
        )}
        {channel.channel_tags && channel.channel_tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {channel.channel_tags.map(tag => (
              <span key={tag} className="rounded bg-muted px-2 py-1 text-sm">
                {tag}
              </span>
            ))}
          </div>
        )}
        {admin && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={pending}
              onClick={async () => {
                if (pending) return;
                const id = channel.channel_id;
                const name = channel.channel_name;
                setConfirming(true);
                try {
                  if (
                    await confirm({
                      title: 'Delete channel?',
                      description: `Delete ${name} including all videos?`,
                      actionLabel: 'Delete channel',
                    })
                  )
                    await mutate(
                      () => deleteChannel(id),
                      () => navigate(NewRoutes.Channels),
                    );
                } finally {
                  setConfirming(false);
                }
              }}
            >
              Delete Channel
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                void mutate(() =>
                  queueReindex([channel.channel_id], ReindexTypeEnum.channel as 'channel'),
                )
              }
            >
              Reindex
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                void mutate(() =>
                  queueReindex([channel.channel_id], ReindexTypeEnum.channel as 'channel', true),
                )
              }
            >
              Reindex Videos
            </Button>
          </div>
        )}
      </Card>
      {admin && (
        <Card className="space-y-3 p-4">
          <h2 className="font-semibold">Channel Customization</h2>
          <p className="text-sm text-muted-foreground">
            Blank numeric and format fields reset to global settings.
          </p>
          <label>
            Download format
            <Input value={format} disabled={pending} onChange={e => setFormat(e.target.value)} />
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => void overwrite('download_format', format || null)}
              >
                Save
              </Button>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => {
                  void overwrite('download_format', null).then(ok => {
                    if (ok) setFormat('');
                  });
                }}
              >
                Reset
              </Button>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => setFormat(channel.channel_overwrites?.download_format ?? '')}
              >
                Cancel
              </Button>
            </div>
          </label>
          <label>
            Auto-delete watched after days
            <Input
              type="number"
              min="0"
              value={days}
              disabled={pending}
              onChange={e => setDays(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => saveNumber('autodelete_days', days)}
              >
                Save
              </Button>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => {
                  void overwrite('autodelete_days', null).then(ok => {
                    if (ok) setDays('');
                  });
                }}
              >
                Reset
              </Button>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() =>
                  setDays(channel.channel_overwrites?.autodelete_days?.toString() ?? '')
                }
              >
                Cancel
              </Button>
            </div>
          </label>
          <label className="flex gap-2">
            Index playlists
            <Checkbox
              checked={channel.channel_overwrites?.index_playlists ?? false}
              disabled={pending}
              onCheckedChange={checked => void overwrite('index_playlists', checked === true)}
            />
          </label>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => void overwrite('index_playlists', null)}
          >
            Reset playlist indexing
          </Button>
          <label>
            SponsorBlock override
            <NativeSelect
              disabled={pending}
              value={sponsor === null ? '' : String(sponsor)}
              onChange={e => {
                const value = e.target.value === '' ? null : e.target.value === 'true';
                setSponsor(value);
                void overwrite('integrate_sponsorblock', value);
              }}
            >
              <option value="">Use global setting</option>
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </NativeSelect>
          </label>
          <h3 className="font-medium">Page Size Overrides (0 disables type)</h3>
          {['Videos', 'Shorts', 'Live streams'].map((name, i) => (
            <label key={name}>
              {name}
              <Input
                type="number"
                min="0"
                value={sizes[i]}
                disabled={pending}
                onChange={e =>
                  setSizes(values => values.map((v, n) => (n === i ? e.target.value : v)))
                }
              />
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    saveNumber(
                      [
                        'subscriptions_channel_size',
                        'subscriptions_shorts_channel_size',
                        'subscriptions_live_channel_size',
                      ][i],
                      sizes[i],
                    )
                  }
                >
                  Save
                </Button>
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    void overwrite(
                      [
                        'subscriptions_channel_size',
                        'subscriptions_shorts_channel_size',
                        'subscriptions_live_channel_size',
                      ][i],
                      null,
                    ).then(ok => {
                      if (ok) setSizes(values => values.map((v, n) => (n === i ? '' : v)));
                    });
                  }}
                >
                  Reset
                </Button>
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    setSizes(values =>
                      values.map((v, n) =>
                        n === i
                          ? ([
                              channel.channel_overwrites?.subscriptions_channel_size,
                              channel.channel_overwrites?.subscriptions_shorts_channel_size,
                              channel.channel_overwrites?.subscriptions_live_channel_size,
                            ][i]?.toString() ?? '')
                          : v,
                      ),
                    )
                  }
                >
                  Cancel
                </Button>
              </div>
            </label>
          ))}
          <label>
            Rolling window (regular videos to keep)
            <p>Persisted policy: {savedRolling || 'Disabled'}</p>
            <Input
              inputMode="numeric"
              value={rolling}
              disabled={pending}
              onChange={e => setRolling(e.target.value)}
            />
          </label>
          <p>
            <strong>Warning: permanent deletion.</strong> Keeps only latest N regular videos from
            YouTube's videos tab. Deletes older videos whether watched or unwatched, including
            existing, manually downloaded and playlist videos from this channel. Shorts and stream
            recordings stay unchanged.
          </p>
          <p>
            Uses regular-video page size, title ignore filters, subscription schedule and download
            auto-start settings, not a full-channel scan. Pending downloads and failed or empty
            scans postpone cleanup. Unavailable or members-only entries can leave fewer videos.
            Saving does not start downloads or delete immediately. Deleted videos stay ignored until
            unignored. Leave blank or reset to disable; disabling does not restore deleted videos.
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={pending}
              onClick={async () => {
                if (pending) return;
                const value = rolling;
                setConfirming(true);
                try {
                  if (
                    !value ||
                    (await confirm({
                      title: 'Save rolling window?',
                      description:
                        'Future subscription scans may permanently delete older regular videos, including watched, unwatched, manually downloaded and playlist videos.',
                      actionLabel: 'Save rolling window',
                    }))
                  )
                    await saveNumber('rolling_window_size', value);
                } finally {
                  setConfirming(false);
                }
              }}
            >
              Save rolling window
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => {
                void saveNumber('rolling_window_size', '');
              }}
            >
              Reset (disable)
            </Button>
            <Button variant="outline" disabled={pending} onClick={() => setRolling(savedRolling)}>
              Cancel
            </Button>
          </div>
          <label>
            Title auto-ignore filter
            <Textarea
              className="w-full rounded border bg-transparent p-2"
              rows={4}
              value={filter}
              disabled={pending}
              onChange={e => setFilter(e.target.value)}
            />
          </label>
          <p>
            Matching titles ignored before download. Use a{' '}
            <a
              className="underline"
              href="https://docs.python.org/3/library/re.html"
              target="_blank"
              rel="noopener noreferrer"
            >
              Python regular expression
            </a>
            . Leave blank to disable. Already downloaded videos stay unchanged.
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => void overwrite('auto_ignore_filter', filter || null)}
            >
              Save title filter
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => {
                setFilter('');
                void overwrite('auto_ignore_filter', null);
              }}
            >
              Disable title filter
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setFilter(channel.channel_overwrites?.auto_ignore_filter ?? '')}
            >
              Cancel
            </Button>
          </div>
        </Card>
      )}
      {saveMessage && <p role="status">{saveMessage}</p>}
      {validationError && <p role="alert">{validationError}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
