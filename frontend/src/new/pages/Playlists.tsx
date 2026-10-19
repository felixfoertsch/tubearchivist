import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { requestedPage, nextPage } from '../pagination';
import { errorMessage, assertResponse } from '../videoMetadata';
import { ViewStylesEnum } from '../../configuration/constants/ViewStyle';
import loadPlaylistList from '../../api/loader/loadPlaylistList';
import type { PlaylistType } from '../../api/loader/loadPlaylistById';
import updateBulkPlaylistSubscriptions from '../../api/actions/updateBulkPlaylistSubscriptions';
import createCustomPlaylist from '../../api/actions/createCustomPlaylist';
import updateUserConfig from '../../api/actions/updateUserConfig';
import { useUserConfigStore } from '../../stores/UserConfigStore';
import useIsAdmin from '../../functions/useIsAdmin';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { NativeSelect } from '../ui/native-select';
import { PlaylistList } from '../components/PlaylistList';
import { useTaskStore } from '../lib/tasks';

export default function Playlists() {
  const { userConfig, setUserConfig } = useUserConfigStore();
  const isAdmin = useIsAdmin();
  const [searchParams, setSearchParams] = useSearchParams();
  const parsedPage = requestedPage(searchParams.get('page'), userConfig.page_size);
  const page = parsedPage ?? 0;
  const [playlists, setPlaylists] = useState<PlaylistType[]>();
  const [pagination, setPagination] =
    useState<NonNullable<Awaited<ReturnType<typeof loadPlaylistList>>['data']>['paginate']>();
  const [manualRevision, setRevision] = useState(0);
  const revision = manualRevision + useTaskStore(state => state.finished);
  const [ids, setIds] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [stylePending, setStylePending] = useState(false);
  const refresh = () => setRevision(value => value + 1);
  const category =
    searchParams.get('type') === 'custom'
      ? 'custom'
      : searchParams.get('type') === 'regular'
        ? 'regular'
        : undefined;
  const requestKey = JSON.stringify([
    page,
    revision,
    userConfig.show_subed_only_playlists,
    category,
  ]);
  const [loadedKey, setLoadedKey] = useState('');
  const loading = loadedKey !== requestKey;

  useEffect(() => {
    let active = true;
    void loadPlaylistList({
      page,
      subscribed: userConfig.show_subed_only_playlists,
      type: category,
    })
      .then(response => {
        assertResponse(response);
        if (!Array.isArray(response.data?.data)) throw new Error('Playlist response missing data');
        if (active) {
          setLoadedKey(requestKey);
          setPlaylists(response.data.data);
          setPagination(response.data.paginate);
          setError('');
        }
      })
      .catch(caught => {
        if (active) setError(errorMessage(caught, 'Could not load playlists'));
      });
    return () => {
      active = false;
    };
  }, [requestKey, category, page, revision, userConfig.show_subed_only_playlists]);

  const mutate = async (action: () => Promise<{ status: number; error?: { error: string } }>) => {
    setPending(true);
    setError('');
    try {
      const response = await action();
      assertResponse(response);
      refresh();
    } catch (caught) {
      setError(errorMessage(caught, 'Playlist update failed'));
    } finally {
      setPending(false);
    }
  };
  const saveFilter = async (value: string) => {
    setPending(true);
    setError('');
    try {
      const response = await updateUserConfig({
        show_subed_only_playlists: value === '' ? null : value === 'true',
      });
      assertResponse(response);
      if (!response.data) throw new Error('Configuration response missing');
      setUserConfig(response.data);
      setSearchParams(previous => {
        const next = new URLSearchParams(previous);
        next.delete('page');
        return next;
      });
      refresh();
    } catch (caught) {
      setError(errorMessage(caught, 'Could not save filter'));
    } finally {
      setPending(false);
    }
  };
  const saveView = async (value: string) => {
    setStylePending(true);
    setError('');
    try {
      const response = await updateUserConfig({
        view_style_playlist: value as typeof userConfig.view_style_playlist,
      });
      assertResponse(response);
      if (!response.data) throw new Error('Configuration response missing');
      setUserConfig(response.data);
    } catch (caught) {
      setError(errorMessage(caught, 'Could not save view'));
    } finally {
      setStylePending(false);
    }
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Playlists</h1>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <Textarea
              rows={3}
              aria-label="Playlist IDs or URLs"
              placeholder="Input playlist IDs or URLs"
              value={ids}
              onChange={e => setIds(e.target.value)}
            />
            <Button
              variant="outline"
              disabled={pending || !ids.trim()}
              onClick={() =>
                void mutate(async () => {
                  const response = await updateBulkPlaylistSubscriptions(ids, true);
                  assertResponse(response);
                  setIds('');
                  return response;
                })
              }
            >
              {pending ? 'Saving…' : 'Subscribe'}
            </Button>
            <Input
              aria-label="Custom playlist name"
              placeholder="Input playlist name"
              value={name}
              onChange={e => setName(e.target.value)}
            />
            <Button
              variant="outline"
              disabled={pending || !name.trim()}
              onClick={() =>
                void mutate(async () => {
                  const response = await createCustomPlaylist(name);
                  assertResponse(response);
                  setName('');
                  return response;
                })
              }
            >
              {pending ? 'Saving…' : 'Create'}
            </Button>
          </div>
        )}
      </header>
      {error && (
        <p role="alert" className="text-sm text-foreground">
          {error}
        </p>
      )}
      <label className="flex items-center gap-2 text-sm">
        Playlist type
        <NativeSelect
          value={category ?? ''}
          onChange={event =>
            setSearchParams(previous => {
              const next = new URLSearchParams(previous);
              next.delete('page');
              if (event.target.value) next.set('type', event.target.value);
              else next.delete('type');
              return next;
            })
          }
        >
          <option value="">All playlists</option>
          <option value="regular">YouTube playlists</option>
          <option value="custom">Custom playlists</option>
        </NativeSelect>
      </label>
      <fieldset
        disabled={pending || stylePending}
        className="flex flex-wrap items-end gap-3 text-sm"
      >
        <label className="flex items-center gap-2">
          Filter subscriptions{' '}
          <NativeSelect
            size="sm"
            value={
              userConfig.show_subed_only_playlists == null
                ? ''
                : String(userConfig.show_subed_only_playlists)
            }
            onChange={e => void saveFilter(e.target.value)}
          >
            <option value="">All</option>
            <option value="true">Subscribed only</option>
            <option value="false">Unsubscribed only</option>
          </NativeSelect>
        </label>
        <label className="flex items-center gap-2">
          View{' '}
          <NativeSelect
            size="sm"
            value={userConfig.view_style_playlist}
            onChange={e => void saveView(e.target.value)}
          >
            <option value={ViewStylesEnum.Grid}>Grid</option>
            <option value={ViewStylesEnum.List}>List</option>
            <option value={ViewStylesEnum.Table}>Table</option>
          </NativeSelect>
        </label>
      </fieldset>
      {loading || !playlists ? (
        <p role="status">Loading playlists…</p>
      ) : playlists.length ? (
        <PlaylistList playlists={playlists} refresh={refresh} />
      ) : (
        <p>No playlists found.</p>
      )}
      {parsedPage === null && <p role="alert">Invalid page; showing first page.</p>}
      <nav aria-label="Pagination" className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          disabled={pending || page <= 1}
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
        <span>Page {pagination?.current_page || page || 1}</span>
        <Button
          variant="outline"
          disabled={pending || nextPage(pagination) === undefined}
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
      </nav>
    </div>
  );
}
