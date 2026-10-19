import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { VideoType } from '../pages/Home';
import loadVideoListByFilter, {
  SortByEnum,
  SortByType,
  SortOrderEnum,
  SortOrderType,
  VideoTypes,
  WatchTypes,
  WatchTypesEnum,
} from '../api/loader/loadVideoListByPage';
import updateUserConfig, { UserConfigType } from '../api/actions/updateUserConfig';
import { useUserConfigStore } from '../stores/UserConfigStore';
import { useFilterBarTempConf } from '../stores/FilterbarTempConf';
import VideoCard from './components/VideoCard';
import VideoCollection from './components/VideoCollection';
import EmbeddableVideoPlayer from './components/EmbeddableVideoPlayer';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { NativeSelect } from './ui/native-select';
import { requestedPage, nextPage } from './pagination';
import { errorMessage, assertResponse } from './videoMetadata';

type VideoResponse = Awaited<ReturnType<typeof loadVideoListByFilter>>;

const listData = (response?: VideoResponse) => {
  const raw: unknown = response?.data;
  if (Array.isArray(raw)) return raw as VideoType[];
  if (raw && typeof raw === 'object' && 'data' in raw && Array.isArray(raw.data))
    return raw.data as VideoType[];
  return [];
};

export function Home() {
  const { userConfig, setUserConfig } = useUserConfigStore();
  const { filterHeight, setFilterHeight } = useFilterBarTempConf();
  const [searchParams, setSearchParams] = useSearchParams();
  const parsedPage = requestedPage(searchParams.get('page'), userConfig.page_size);
  const page = parsedPage ?? 0;
  const [refreshCount, setRefreshCount] = useState(0);
  const [recentResult, setRecentResult] = useState<{
    key: string;
    response?: VideoResponse;
    error?: string;
  }>();
  const [continueResult, setContinueResult] = useState<{
    key: string;
    response?: VideoResponse;
    error?: string;
  }>();
  const recentKey = JSON.stringify([
    page,
    userConfig.hide_watched,
    userConfig.vid_type_filter,
    userConfig.sort_by,
    userConfig.sort_order,
    filterHeight,
    refreshCount,
    searchParams.get('videoId'),
  ]);
  const continueKey = JSON.stringify([refreshCount, searchParams.get('videoId')]);
  const recent = recentResult?.key === recentKey ? recentResult.response : undefined;
  const recentError = recentResult?.key === recentKey ? (recentResult.error ?? '') : '';
  const recentLoading = recentResult?.key !== recentKey;
  const continuing = continueResult?.key === continueKey ? continueResult.response : undefined;
  const continueError = continueResult?.key === continueKey ? (continueResult.error ?? '') : '';
  const continueLoading = continueResult?.key !== continueKey;
  const [configError, setConfigError] = useState('');
  const [configPending, setConfigPending] = useState(false);
  const configLock = useRef(false);
  const refresh = useCallback(() => setRefreshCount(count => count + 1), [setRefreshCount]);

  useEffect(() => {
    let active = true;
    void loadVideoListByFilter({
      page,
      watch:
        userConfig.hide_watched === null
          ? null
          : ((userConfig.hide_watched
              ? WatchTypesEnum.Watched
              : WatchTypesEnum.Unwatched) as WatchTypes),
      type: userConfig.vid_type_filter ?? undefined,
      sort: userConfig.sort_by,
      order: userConfig.sort_order,
      height: filterHeight,
    })
      .then(response => {
        assertResponse(response);
        if (!response.data || (!Array.isArray(response.data) && !Array.isArray(response.data.data)))
          throw new Error('Invalid video list response');
        if (active) setRecentResult({ key: recentKey, response });
      })
      .catch(caught => {
        if (active)
          setRecentResult({
            key: recentKey,
            error: errorMessage(caught, 'Could not load recent videos'),
          });
      });
    return () => {
      active = false;
    };
  }, [
    recentKey,
    page,
    userConfig.hide_watched,
    userConfig.vid_type_filter,
    userConfig.sort_by,
    userConfig.sort_order,
    filterHeight,
  ]);

  useEffect(() => {
    let active = true;
    void loadVideoListByFilter({ watch: WatchTypesEnum.Continue as WatchTypes })
      .then(response => {
        assertResponse(response);
        if (!response.data || (!Array.isArray(response.data) && !Array.isArray(response.data.data)))
          throw new Error('Invalid video list response');
        if (active) setContinueResult({ key: continueKey, response });
      })
      .catch(caught => {
        if (active)
          setContinueResult({
            key: continueKey,
            error: errorMessage(caught, 'Could not load Continue Watching'),
          });
      });
    return () => {
      active = false;
    };
  }, [continueKey]);

  const saveConfig = async (config: Partial<UserConfigType>) => {
    if (configLock.current) return;
    configLock.current = true;
    setConfigPending(true);
    setConfigError('');
    try {
      const response = await updateUserConfig(config);
      assertResponse(response);
      if (!response.data) throw new Error('Configuration response missing');
      setUserConfig(response.data);
      setSearchParams(params => {
        params.delete('page');
        return params;
      });
    } catch (caught) {
      setConfigError(errorMessage(caught, 'Could not save configuration'));
    } finally {
      configLock.current = false;
      setConfigPending(false);
    }
  };
  const videos = listData(recent);
  const continuingVideos = listData(continuing);
  const grid = userConfig.view_style_home === 'grid';
  const pagination = recent?.data && !Array.isArray(recent.data) ? recent.data.paginate : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Home</h1>
        <Button variant="ghost" size="sm" asChild>
          <a href="/old/">Classic Home</a>
        </Button>
      </div>
      <EmbeddableVideoPlayer videoId={searchParams.get('videoId')} />
      {configError && <p role="alert">{configError}</p>}
      {parsedPage === null && <p role="alert">Invalid page. Showing first page.</p>}
      {(continueLoading || continueError || continuingVideos.length > 0) && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Continue Watching</h2>
          {continueError ? (
            <p role="alert">
              {continueError}{' '}
              <Button variant="default" size="sm" onClick={refresh}>
                Retry
              </Button>
            </p>
          ) : continueLoading ? (
            <p role="status">Loading Continue Watching…</p>
          ) : (
            continuingVideos.length > 0 && (
              <div className="grid gap-3 md:grid-cols-2">
                {continuingVideos.map(video => (
                  <VideoCard key={video.youtube_id} video={video} refresh={refresh} compact />
                ))}
              </div>
            )
          )}
        </section>
      )}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Recent Videos</h2>
        <fieldset
          disabled={configPending}
          className="flex flex-wrap items-end gap-2 text-xs disabled:opacity-60"
        >
          <label>
            Watched
            <NativeSelect
              size="sm"
              value={userConfig.hide_watched === null ? '' : String(userConfig.hide_watched)}
              onChange={e =>
                void saveConfig({
                  hide_watched: e.target.value === '' ? null : e.target.value === 'true',
                })
              }
            >
              <option value="">All</option>
              <option value="true">Watched</option>
              <option value="false">Unwatched</option>
            </NativeSelect>
          </label>
          <label>
            Type
            <NativeSelect
              size="sm"
              value={userConfig.vid_type_filter ?? ''}
              onChange={e =>
                void saveConfig({ vid_type_filter: (e.target.value || null) as VideoTypes | null })
              }
            >
              <option value="">All types</option>
              <option value="videos">Videos</option>
              <option value="streams">Streams</option>
              <option value="shorts">Shorts</option>
            </NativeSelect>
          </label>
          <label>
            Height (px)
            <Input
              className="h-8 w-24"
              type="number"
              step="1"
              min="1"
              value={filterHeight}
              onChange={e => {
                if (/^\d*$/.test(e.target.value)) {
                  setFilterHeight(e.target.value);
                  setSearchParams(params => {
                    params.delete('page');
                    return params;
                  });
                }
              }}
            />
          </label>
          <label>
            Sort
            <NativeSelect
              size="sm"
              value={userConfig.sort_by}
              onChange={e => void saveConfig({ sort_by: e.target.value as SortByType })}
            >
              {Object.entries(SortByEnum).map(([label, value]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label>
            Order
            <NativeSelect
              size="sm"
              value={userConfig.sort_order}
              onChange={e => void saveConfig({ sort_order: e.target.value as SortOrderType })}
            >
              {Object.entries(SortOrderEnum).map(([label, value]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label>
            View
            <NativeSelect
              size="sm"
              value={userConfig.view_style_home}
              onChange={e =>
                void saveConfig({
                  view_style_home: e.target.value as UserConfigType['view_style_home'],
                })
              }
            >
              <option value="grid">Grid</option>
              <option value="list">List</option>
              <option value="table">Table</option>
            </NativeSelect>
          </label>
          {grid && (
            <label>
              Columns
              <Input
                className="h-8 w-20"
                type="number"
                min={3}
                max={7}
                value={userConfig.grid_items}
                onChange={e => {
                  const n = Math.max(3, Math.min(7, Number(e.target.value)));
                  void saveConfig({ grid_items: n });
                }}
              />
            </label>
          )}
        </fieldset>
        <VideoCollection
          key={JSON.stringify([userConfig.hide_watched, userConfig.vid_type_filter, filterHeight])}
          videos={videos}
          refresh={refresh}
          loading={recentLoading || Boolean(recentError)}
        />
        {recentError && (
          <p role="alert">
            {recentError}{' '}
            <Button variant="default" size="sm" onClick={refresh}>
              Retry
            </Button>{' '}
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setSearchParams(params => {
                  params.delete('page');
                  return params;
                })
              }
            >
              First page
            </Button>
          </p>
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
            Page {pagination?.current_page || page || 1}
            {pagination?.total_hits !== undefined &&
              ` · ${new Intl.NumberFormat().format(pagination.total_hits)} videos`}
          </span>
          <Button
            variant="outline"
            disabled={nextPage(pagination) === undefined}
            onClick={() =>
              setSearchParams(params => {
                const next = nextPage(pagination);
                if (next !== undefined) params.set('page', String(next));
                return params;
              })
            }
          >
            Next
          </Button>
          {pagination?.last_page && (
            <Button
              variant="outline"
              onClick={() =>
                setSearchParams(params => {
                  params.set('page', String(pagination.last_page));
                  return params;
                })
              }
            >
              Last ({new Intl.NumberFormat().format(pagination.last_page)})
            </Button>
          )}
        </nav>
      </section>
    </div>
  );
}

export default Home;
