import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import loadChannelList from '../../api/loader/loadChannelList';
import updateBulkChannelSubscriptions from '../../api/actions/updateBulkChannelSubscriptions';
import updateUserConfig from '../../api/actions/updateUserConfig';
import useIsAdmin from '../../functions/useIsAdmin';
import { useUserConfigStore } from '../../stores/UserConfigStore';
import { Button } from '../ui/button';
import { ChannelsList } from '../components/ChannelsList';
import TaskNotifications from '../components/TaskNotifications';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { NativeSelect } from '../ui/native-select';
import { requestedPage, nextPage } from '../pagination';
import type { ChannelType } from '../../pages/Channels';
import { errorMessage } from '../videoMetadata';
import { ViewStylesEnum } from '../../configuration/constants/ViewStyle';

type Response = Awaited<ReturnType<typeof loadChannelList>>;
type ChannelRecord = ChannelType;
const assertResponse = (r: { status: number; error?: { error: string } }) => {
  if (r.error || r.status < 200 || r.status >= 300)
    throw new Error(r.error?.error ?? `Request failed (${r.status})`);
};

export default function Channels() {
  const { userConfig, setUserConfig } = useUserConfigStore();
  const admin = useIsAdmin();
  const [params, setParams] = useSearchParams();
  const parsed = requestedPage(params.get('page'), userConfig.page_size);
  const page = parsed ?? 1;
  const [count, setCount] = useState(0);
  const [result, setResult] = useState<{ key: string; response?: Response; error?: string }>();
  const [filter, setFilter] = useState(false);
  const [nameFilter, setNameFilter] = useState('');
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const key = JSON.stringify([page, userConfig.show_subed_only, count]);
  const response = result?.key === key ? result.response : undefined;
  const channels: ChannelRecord[] = response?.data?.data ?? [];
  const pagination = response?.data?.paginate;
  const filteredChannels = channels.filter(c =>
    c.channel_name.toLocaleLowerCase().includes(nameFilter.trim().toLocaleLowerCase()),
  );
  const refresh = () => setCount(n => n + 1);

  useEffect(() => {
    let active = true;
    void loadChannelList(page, userConfig.show_subed_only)
      .then(r => {
        assertResponse(r);
        if (!Array.isArray(r.data?.data)) throw new Error('Channel list response missing');
        if (active) setResult({ key, response: r });
      })
      .catch(e => active && setResult({ key, error: errorMessage(e, 'Could not load channels') }));
    return () => {
      active = false;
    };
  }, [key, page, userConfig.show_subed_only]);

  const saveConfig = async (config: Parameters<typeof updateUserConfig>[0]) => {
    setPending(true);
    setError('');
    try {
      const r = await updateUserConfig(config);
      assertResponse(r);
      if (!r.data) throw new Error('Configuration response missing');
      setUserConfig(r.data);
      if ('show_subed_only' in config)
        setParams(current => {
          current.delete('page');
          return current;
        });
    } catch (e) {
      setError(errorMessage(e, 'Could not save configuration'));
    } finally {
      setPending(false);
    }
  };
  const subscribeMany = async () => {
    if (!input.trim() || pending) return;
    setPending(true);
    setError('');
    try {
      const r = await updateBulkChannelSubscriptions(input.trim(), true);
      assertResponse(r);
      setInput('');
      refresh();
    } catch (e) {
      setError(errorMessage(e, 'Could not subscribe'));
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Channels</h1>
        {admin && (
          <div className="flex flex-wrap gap-2">
            <form
              className="flex flex-wrap gap-2"
              onSubmit={e => {
                e.preventDefault();
                void subscribeMany();
              }}
            >
              <label className="sr-only" htmlFor="channel-ids">
                Channel IDs, URLs, or video URLs
              </label>
              <Textarea
                rows={3}
                id="channel-ids"
                className="w-72 max-w-full"
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Channel IDs, URLs, or video URLs"
              />
              <Button variant="outline" disabled={pending || !input.trim()}>
                {pending ? 'Working…' : 'Subscribe'}
              </Button>
            </form>
          </div>
        )}
      </header>
      {admin && <TaskNotifications key={count} pageName="all" onComplete={refresh} />}
      {error && <p role="alert">{error}</p>}
      {parsed === null && <p role="alert">Invalid page. Showing first page.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => setFilter(v => !v)} aria-expanded={filter}>
          Filter
        </Button>
        {filter && (
          <>
            <label className="text-sm">
              Subscription state{' '}
              <NativeSelect
                size="sm"
                disabled={pending}
                value={userConfig.show_subed_only == null ? '' : String(userConfig.show_subed_only)}
                onChange={e =>
                  void saveConfig({
                    show_subed_only: e.target.value === '' ? null : e.target.value === 'true',
                  })
                }
              >
                <option value="">All</option>
                <option value="true">Subscribed</option>
                <option value="false">Unsubscribed</option>
              </NativeSelect>
            </label>
            <label className="text-sm">
              Filter by name
              <Input
                className="h-8"
                value={nameFilter}
                onChange={e => setNameFilter(e.target.value)}
              />
            </label>
          </>
        )}
        <label className="text-sm">
          View{' '}
          <NativeSelect
            size="sm"
            disabled={pending}
            value={userConfig.view_style_channel}
            onChange={e =>
              void saveConfig({
                view_style_channel: e.target.value as typeof userConfig.view_style_channel,
              })
            }
          >
            <option value={ViewStylesEnum.Grid}>Grid</option>
            <option value={ViewStylesEnum.List}>List</option>
            <option value={ViewStylesEnum.Table}>Table</option>
          </NativeSelect>
        </label>
      </div>
      {result?.key === key && result.error ? (
        <p role="alert">{result.error}</p>
      ) : !response ? (
        <p>Loading channels…</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {new Intl.NumberFormat().format(pagination?.total_hits ?? channels.length)} channels
          </p>
          {filteredChannels.length === 0 ? (
            <p>No channels found.</p>
          ) : (
            <ChannelsList channels={filteredChannels} refresh={refresh} />
          )}
        </>
      )}
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
        <span>
          Page {pagination?.current_page || page || 1}
          {pagination?.total_hits !== undefined &&
            ` · ${new Intl.NumberFormat().format(pagination.total_hits)} channels`}
        </span>
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
        {pagination?.last_page && (
          <Button
            variant="outline"
            onClick={() =>
              setParams(p => {
                p.set('page', String(pagination.last_page));
                return p;
              })
            }
          >
            Last ({pagination.last_page})
          </Button>
        )}
      </nav>
    </main>
  );
}
