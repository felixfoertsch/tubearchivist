import { useConfirm } from '../components/useConfirm';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import loadDownloadQueue from '../../api/loader/loadDownloadQueue';
import loadDownloadAggs from '../../api/loader/loadDownloadAggs';
import updateDownloadQueue from '../../api/actions/updateDownloadQueue';
import updateDownloadQueueByFilter, {
  type DownloadQueueStatus,
} from '../../api/actions/updateDownloadQueueByFilter';
import updateTaskByName from '../../api/actions/updateTaskByName';
import updateUserConfig from '../../api/actions/updateUserConfig';
import loadChannelById from '../../api/loader/loadChannelById';
import updateChannelOverwrites from '../../api/actions/updateChannelOverwrite';
import deleteDownloadQueueByFilter from '../../api/actions/deleteDownloadQueueByFilter';
import { useUserConfigStore } from '../../stores/UserConfigStore';
import useIsAdmin from '../../functions/useIsAdmin';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Checkbox } from '../ui/checkbox';
import { NativeSelect } from '../ui/native-select';
import { Card } from '../ui/card';
import { ViewStylesEnum, type ViewStylesType } from '../../configuration/constants/ViewStyle';
import {
  assertDownloadResponse,
  downloadPage,
  downloadQueryKey,
  downloadPreviousPage,
  downloadBulkScope,
} from '../lib/download';
import { nextPage } from '../pagination';
import { DownloadItem } from '../components/DownloadItem';
import { Collection } from '../components/Collection';
import TaskNotifications from '../components/TaskNotifications';
import { useTaskStore } from '../lib/tasks';

import type { DownloadResponseType } from '../lib/download';

export function Download() {
  const { confirm, dialog } = useConfirm();
  const admin = useIsAdmin();
  const { userConfig, setUserConfig } = useUserConfigStore();
  const [params, setParams] = useSearchParams();
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    data?: DownloadResponseType;
    error?: string;
  }>();
  const [channels, setChannels] = useState<{ key: string[]; doc_count: number }[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [configPending, setConfigPending] = useState(false);
  const [pending, setPending] = useState(false);
  const [search, setSearch] = useState('');
  const [queueText, setQueueText] = useState('');
  const [fast, setFast] = useState(false);
  const [force, setForce] = useState(false);
  const [autostart, setAutostart] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);
  const [titleRegex, setTitleRegex] = useState('');
  const [regexError, setRegexError] = useState('');
  const [regexStatus, setRegexStatus] = useState('');
  const [regexLoad, setRegexLoad] = useState<{
    channel: string;
    error?: string;
    loaded: boolean;
  }>();
  const [regexRetry, setRegexRetry] = useState(0);
  const tasks = useTaskStore(state => state.tasks);
  const taskAdvanced = useTaskStore(state => state.advanced);
  const activeTask = tasks.find(task => task.youtube_id);
  const ignored =
    params.get('ignored') === null
      ? userConfig.show_ignored_only
      : params.get('ignored') === 'true';
  const channel = params.get('channel');
  const type = params.get('vid-type');
  const errorFilter = params.get('error');
  const page = downloadPage(params.get('page'));
  const apiPage = page === 1 ? 0 : page;
  const queryKey = downloadQueryKey(apiPage, channel, type, errorFilter, ignored, search);
  const response = result?.key === queryKey ? result.data : undefined;
  const queueError = result?.key === queryKey ? result.error : undefined;
  const queueReady = !!response;
  const regexReady = !!channel && regexLoad?.channel === channel && regexLoad.loaded;
  const deleteScope = downloadBulkScope(ignored, channel, type);
  const patchScope = downloadBulkScope(ignored, channel, type, errorFilter);
  const refreshList = useCallback(() => setRefresh(value => value + 1), []);
  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value && value !== 'all') next.set(key, value);
    else next.delete(key);
    if (key === 'page') {
      if (value === '0') next.delete('page');
    } else next.set('page', '1');
    setParams(next);
  };
  useEffect(() => {
    let active = true;
    if (!admin)
      return () => {
        active = false;
      };
    void loadDownloadQueue(apiPage, channel, type, errorFilter, ignored, search)
      .then(raw => {
        const data = assertDownloadResponse(raw);
        if (active) {
          setResult({ key: queryKey, data });
        }
      })
      .catch(caught => {
        if (active)
          setResult({
            key: queryKey,
            error: caught instanceof Error ? caught.message : 'Could not load downloads',
          });
      });
    return () => {
      active = false;
    };
  }, [
    admin,
    apiPage,
    channel,
    type,
    errorFilter,
    ignored,
    search,
    refresh,
    taskAdvanced,
    queryKey,
  ]);
  useEffect(() => {
    let active = true;
    if (!admin || !channel) {
      return () => {
        active = false;
      };
    }
    void loadChannelById(channel)
      .then(raw => {
        if (raw.error || raw.status < 200 || raw.status >= 300 || !raw.data)
          throw new Error(raw.error?.error ?? `Request failed (${raw.status})`);
        if (active) {
          setTitleRegex(raw.data.channel_overwrites?.auto_ignore_filter ?? '');
          setRegexLoad({ channel, loaded: true });
          setRegexError('');
          setRegexStatus('');
        }
      })
      .catch(caught => {
        if (active)
          setRegexLoad({
            channel,
            loaded: false,
            error: caught instanceof Error ? caught.message : 'Could not load channel filter',
          });
      });
    return () => {
      active = false;
    };
  }, [admin, channel, regexRetry]);
  useEffect(() => {
    let active = true;
    if (!admin)
      return () => {
        active = false;
      };
    void loadDownloadAggs(ignored)
      .then(raw => {
        if (raw.error || raw.status < 200 || raw.status >= 300 || !Array.isArray(raw.data?.buckets))
          throw new Error(raw.error?.error ?? `Request failed (${raw.status})`);
        if (active) setChannels(raw.data.buckets);
      })
      .catch(caught => {
        if (active) setError(caught instanceof Error ? caught.message : 'Could not load channels');
      });
    return () => {
      active = false;
    };
  }, [admin, ignored, refresh]);
  const action = async (
    run: () => Promise<unknown>,
    message: string,
    consent?: { title: string; description: string; actionLabel?: string },
  ): Promise<boolean> => {
    if (pending) return false;
    setPending(true);
    setError('');
    setNotice('');
    try {
      if (consent && !(await confirm(consent))) return false;
      const result = (await run()) as { status?: number; error?: { error: string } };
      if (
        result?.error ||
        (result?.status !== undefined && (result.status < 200 || result.status >= 300))
      )
        throw new Error(result.error?.error ?? `Request failed (${result.status})`);
      setNotice(message);
      refreshList();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Request failed');
      return false;
    } finally {
      setPending(false);
    }
  };
  if (!admin)
    return (
      <Card className="p-4">
        <h1 className="text-lg font-semibold">Downloads</h1>
        <p role="alert">Administrator access required.</p>
      </Card>
    );
  const list = response?.data ?? [];
  const pagination = response?.paginate;
  const currentPage = pagination?.current_page ?? apiPage;
  const lastPage = pagination?.last_page || 0;
  const previousPage = downloadPreviousPage(currentPage);
  const followingPage = nextPage(
    pagination
      ? {
          ...pagination,
          last_page: pagination.last_page || undefined,
          next_pages: pagination.next_pages as [] | undefined,
          prev_pages: pagination.prev_pages || undefined,
        }
      : undefined,
  );
  return (
    <section className="space-y-3">
      {dialog}
      <header>
        <h1 className="text-xl font-semibold">
          Downloads{channel && list[0] ? ` for ${list[0].channel_name}` : ''}
        </h1>
      </header>
      {error && (
        <p role="alert" className="text-sm text-foreground">
          {error}
        </p>
      )}
      {queueError && (
        <p role="alert" className="text-sm text-foreground">
          {queueError}{' '}
          <Button variant="default" onClick={refreshList}>
            Retry loading queue
          </Button>
        </p>
      )}
      {!queueReady && !queueError && <p role="status">Loading queue…</p>}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      <TaskNotifications />
      <div className="flex flex-wrap gap-2">
        <NativeSelect
          aria-label="Download view"
          disabled={configPending}
          value={userConfig.view_style_downloads}
          onChange={event => {
            const view = event.target.value as ViewStylesType;
            if (view !== ViewStylesEnum.Grid && view !== ViewStylesEnum.List) return;
            setConfigPending(true);
            void updateUserConfig({ view_style_downloads: view })
              .then(result => {
                if (result.error || result.status < 200 || result.status >= 300 || !result.data)
                  throw new Error(result.error?.error ?? `Request failed (${result.status})`);
                setUserConfig(result.data);
              })
              .catch(caught =>
                setError(caught instanceof Error ? caught.message : 'Could not update view'),
              )
              .finally(() => setConfigPending(false));
          }}
        >
          <option value={ViewStylesEnum.List}>List</option>
          <option value={ViewStylesEnum.Grid}>Grid</option>
        </NativeSelect>
        {userConfig.view_style_downloads === ViewStylesEnum.Grid && (
          <NativeSelect
            aria-label="Grid columns"
            disabled={configPending}
            value={String(userConfig.grid_items)}
            onChange={event => {
              const columns = Number(event.target.value);
              if (!Number.isInteger(columns) || columns < 3 || columns > 7) return;
              setConfigPending(true);
              void updateUserConfig({ grid_items: columns })
                .then(result => {
                  if (result.error || result.status < 200 || result.status >= 300 || !result.data)
                    throw new Error(result.error?.error ?? `Request failed (${result.status})`);
                  setUserConfig(result.data);
                })
                .catch(caught =>
                  setError(caught instanceof Error ? caught.message : 'Could not update grid'),
                )
                .finally(() => setConfigPending(false));
            }}
          >
            {[3, 4, 5, 6, 7].map(columns => (
              <option key={columns} value={columns}>
                {columns} columns
              </option>
            ))}
          </NativeSelect>
        )}
        <Button
          variant="default"
          disabled={pending}
          onClick={() =>
            void action(() => updateTaskByName('update_subscribed'), 'Subscription rescan started')
          }
        >
          Rescan subscriptions
        </Button>
        <Button
          variant="default"
          disabled={pending}
          onClick={() =>
            void action(() => updateTaskByName('download_pending'), 'Download started')
          }
        >
          Start download
        </Button>
        <Button
          variant="outline"
          aria-expanded={advanced}
          onClick={() => setAdvanced(value => !value)}
        >
          {advanced ? 'Hide advanced' : 'Show advanced'}
        </Button>
        <Button variant="outline" onClick={refreshList}>
          Refresh
        </Button>
      </div>
      <Card className="space-y-2 p-3">
        <h2 className="font-medium">Add to download queue</h2>
        <Textarea
          className="min-h-20"
          aria-label="Video, channel, or playlist URLs"
          value={queueText}
          onChange={event => setQueueText(event.target.value)}
          placeholder="Enter video, channel or playlist IDs/URLs, one per line"
        />
        <div className="flex flex-wrap gap-4 text-sm">
          {[
            ['Fast add', fast, setFast],
            ['Re-download', force, setForce],
            ['Auto download', autostart, setAutostart],
          ].map(([label, value, setter]) => (
            <label key={String(label)} className="flex items-center gap-2">
              <Checkbox
                checked={Boolean(value)}
                onCheckedChange={checked => (setter as (v: boolean) => void)(checked === true)}
              />
              {String(label)}
            </label>
          ))}
        </div>
        <Button
          variant="default"
          disabled={pending || !queueText.trim()}
          onClick={() =>
            void action(
              () =>
                updateDownloadQueue({
                  youtubeIdStrings: queueText.trim(),
                  flat: fast,
                  force,
                  autostart,
                }),
              'Queue updated',
            ).then(success => {
              if (success) setQueueText('');
            })
          }
        >
          Add to queue
        </Button>
      </Card>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-2">
          <Checkbox
            disabled={configPending}
            checked={ignored}
            onCheckedChange={checked => {
              if (configPending) return;
              const enabled = checked === true;
              setConfigPending(true);
              void updateUserConfig({ show_ignored_only: enabled })
                .then(result => {
                  if (result.error || result.status < 200 || result.status >= 300 || !result.data)
                    throw new Error(result.error?.error ?? `Request failed (${result.status})`);
                  setUserConfig(result.data);
                  const next = new URLSearchParams(params);
                  next.set('ignored', String(enabled));
                  next.set('page', '1');
                  setParams(next);
                })
                .catch(caught =>
                  setError(
                    caught instanceof Error ? caught.message : 'Could not update preferences',
                  ),
                )
                .finally(() => setConfigPending(false));
            }}
          />
          Show only ignored
        </label>
        {advanced && (
          <>
            <NativeSelect
              aria-label="Video type"
              value={type ?? 'all'}
              onChange={event => setFilter('vid-type', event.target.value)}
            >
              <option value="all">All types</option>
              <option value="videos">Videos</option>
              <option value="streams">Streams</option>
              <option value="shorts">Shorts</option>
            </NativeSelect>
            <NativeSelect
              aria-label="Channel"
              value={channel ?? 'all'}
              onChange={event => setFilter('channel', event.target.value)}
            >
              <option value="all">All channels</option>
              {channels.map(item => (
                <option key={item.key[1]} value={item.key[1]}>
                  {item.key[0]} ({item.doc_count})
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label="Error state"
              value={errorFilter ?? 'all'}
              onChange={event => setFilter('error', event.target.value)}
            >
              <option value="all">All errors</option>
              <option value="true">Has error</option>
              <option value="false">No error</option>
            </NativeSelect>
            <Input
              aria-label="Search downloads"
              placeholder="Search titles"
              value={search}
              onChange={event => setSearch(event.target.value)}
            />
            {channel && (
              <Card className="w-full space-y-2 p-3">
                <label htmlFor="download-title-regex" className="font-medium">
                  Channel title auto-ignore regex
                </label>
                <p className="text-xs text-muted-foreground">
                  Python regular expression. Matching titles are ignored before download; existing
                  downloads are unaffected. Blank disables.
                </p>
                <Textarea
                  id="download-title-regex"
                  className="min-h-20 font-mono"
                  value={regexReady ? titleRegex : ''}
                  disabled={!regexReady || pending}
                  onChange={event => {
                    setTitleRegex(event.target.value);
                    setRegexError('');
                    setRegexStatus('');
                  }}
                />
                <Button
                  variant="default"
                  disabled={pending || !regexReady}
                  onClick={() => {
                    if (!regexReady) return;
                    setPending(true);
                    setRegexError('');
                    setRegexStatus('');
                    void updateChannelOverwrites(channel, 'auto_ignore_filter', titleRegex || null)
                      .then(result => {
                        if (result.error || result.status < 200 || result.status >= 300)
                          throw new Error(
                            result.error?.error ?? `Request failed (${result.status})`,
                          );
                        setRegexStatus('Saved');
                      })
                      .catch(caught =>
                        setRegexError(
                          caught instanceof Error ? caught.message : 'Could not save filter',
                        ),
                      )
                      .finally(() => setPending(false));
                  }}
                >
                  Save title filter
                </Button>
                {!regexReady &&
                  (regexLoad?.channel === channel && regexLoad.error ? (
                    <p role="alert">
                      {regexLoad.error}{' '}
                      <Button
                        variant="default"
                        onClick={() => {
                          setRegexLoad(undefined);
                          setRegexRetry(value => value + 1);
                        }}
                      >
                        Retry channel filter
                      </Button>
                    </p>
                  ) : (
                    <p role="status">Loading channel filter…</p>
                  ))}
                {regexReady && regexStatus && <span role="status">{regexStatus}</span>}
                {regexReady && regexError && (
                  <p role="alert" className="text-foreground">
                    {regexError}
                  </p>
                )}
              </Card>
            )}
            {search && (
              <Button variant="ghost" onClick={() => setSearch('')}>
                Clear search
              </Button>
            )}
            <p className="w-full text-xs text-muted-foreground">
              Bulk updates affect all matches for {patchScope}. Title search is excluded; not
              limited to visible page.
            </p>
            <div className="flex flex-wrap gap-1">
              {(ignored
                ? [['pending', 'Add to queue']]
                : [
                    ['ignore', 'Ignore'],
                    ['priority', 'Download now'],
                    ['clear_error', 'Clear errors'],
                  ]
              ).map(([status, label]) => (
                <Button
                  key={status}
                  variant={status === 'ignore' ? 'destructive' : 'default'}
                  disabled={pending || !queueReady}
                  onClick={() =>
                    void action(
                      () =>
                        updateDownloadQueueByFilter(
                          ignored ? 'ignore' : 'pending',
                          channel,
                          type,
                          errorFilter,
                          status as DownloadQueueStatus,
                        ),
                      label,
                    )
                  }
                >
                  {label}
                </Button>
              ))}
            </div>
            <p className="w-full text-xs text-muted-foreground">
              Forget scope: {deleteScope}. Title/error filters are excluded; affects all matching
              status/channel/type entries. Clear title and error filters before deleting.
            </p>
            {confirmForget ? (
              <>
                <Button
                  variant="destructive"
                  disabled={pending || !queueReady || !!search || !!errorFilter}
                  onClick={() => {
                    const status = ignored ? 'ignore' : 'pending';
                    const channelId = channel;
                    const videoType = type;
                    const scope = deleteScope;
                    void action(
                      () => deleteDownloadQueueByFilter(status, channelId, videoType),
                      'Filtered queue forgotten',
                      {
                        title: 'Forget filtered queue?',
                        description: `Forget all queue entries matching ${scope}. Title search and error filters are excluded. This affects all matching status/channel/type entries, not only visible page.`,
                        actionLabel: 'Forget',
                      },
                    ).then(success => {
                      if (success) setConfirmForget(false);
                    });
                  }}
                >
                  Confirm forget
                </Button>
                <Button variant="outline" onClick={() => setConfirmForget(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                variant="destructive"
                disabled={pending || !queueReady || !!search || !!errorFilter}
                onClick={() => setConfirmForget(true)}
              >
                Forget filtered
              </Button>
            )}
          </>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        Total videos in queue: {pagination?.total_hits ?? '—'}
        {channel && ` · channel ${list[0]?.channel_name ?? channel}`}
        {type && ` · ${type}`}
      </p>
      {queueReady && list.length === 0 && !queueError && (
        <p className="py-8 text-center text-sm text-muted-foreground">No downloads found.</p>
      )}
      <Collection grid={userConfig.view_style_downloads === 'grid'}>
        {list.map(item => (
          <DownloadItem
            key={`${item.channel_id}_${item.timestamp}_${item.youtube_id}`}
            download={item}
            task={activeTask?.youtube_id === item.youtube_id ? activeTask : undefined}
            grid={userConfig.view_style_downloads === ViewStylesEnum.Grid}
            refresh={refreshList}
          />
        ))}
      </Collection>
      {pagination && (
        <nav
          aria-label="Download pages"
          className="flex flex-wrap items-center justify-center gap-2"
        >
          {pagination.prev_pages?.map(previousPage => (
            <Button
              key={previousPage}
              variant="outline"
              aria-label={`Go to page ${previousPage}`}
              onClick={() => setFilter('page', String(previousPage))}
            >
              {previousPage}
            </Button>
          ))}
          <Button
            variant="outline"
            disabled={previousPage === undefined}
            onClick={() => previousPage !== undefined && setFilter('page', String(previousPage))}
          >
            Previous
          </Button>
          <span className="text-sm">
            Page {currentPage === 0 ? 1 : currentPage}
            {lastPage > 0 ? ` of ${lastPage}` : ''} · {pagination.total_hits} items
          </span>
          <Button
            variant="outline"
            disabled={followingPage === undefined}
            onClick={() => followingPage !== undefined && setFilter('page', String(followingPage))}
          >
            Next
          </Button>
          {pagination.next_pages?.map(nextPage => (
            <Button
              key={nextPage}
              variant="outline"
              aria-label={`Go to page ${nextPage}`}
              onClick={() => setFilter('page', String(nextPage))}
            >
              {nextPage}
            </Button>
          ))}
          {pagination.last_page !== false && pagination.last_page > 0 && (
            <Button
              variant="outline"
              onClick={() => setFilter('page', String(pagination.last_page))}
            >
              Last ({pagination.last_page})
            </Button>
          )}
        </nav>
      )}
    </section>
  );
}

export default Download;
