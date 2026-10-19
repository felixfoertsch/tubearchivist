import { useState } from 'react';
import { Collection, CollectionImage, CollectionItem } from './Collection';
import { Link } from 'react-router-dom';
import updateChannelSubscription from '../../api/actions/updateChannelSubscription';
import useIsAdmin from '../../functions/useIsAdmin';
import type { ChannelType } from '../../pages/Channels';
import { useUserConfigStore } from '../../stores/UserConfigStore';
import NewRoutes from '../routes';
import { Button } from '../ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { assertResponse, errorMessage, isoDate } from '../videoMetadata';

export function ChannelsList({
  channels,
  refresh,
}: {
  channels: ChannelType[];
  refresh: () => void;
}) {
  const admin = Boolean(useIsAdmin());
  const { view_style_channel: view } = useUserConfigStore(state => state.userConfig);
  const rows = channels.map(channel => (
    <ChannelCard
      key={channel.channel_id}
      channel={channel}
      refresh={refresh}
      admin={admin}
      view={view}
    />
  ));
  if (view === 'table') {
    return (
      <Table className="table-fixed" aria-label="Channels">
        <TableHeader>
          <TableRow>
            <TableHead>Channel</TableHead>
            <TableHead className="hidden w-32 sm:table-cell">Subscribers</TableHead>
            <TableHead className="hidden w-36 sm:table-cell">Last refreshed</TableHead>
            {admin && (
              <TableHead className="w-28">
                <span className="sr-only">Subscription</span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>{rows}</TableBody>
      </Table>
    );
  }
  return <Collection grid={view === 'grid'}>{rows}</Collection>;
}

function ChannelCard({
  channel,
  refresh,
  admin,
  view,
}: {
  channel: ChannelType;
  refresh: () => void;
  admin: boolean;
  view: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const toggle = async () => {
    if (pending || !admin) return;
    setPending(true);
    setError('');
    try {
      const response = await updateChannelSubscription(
        channel.channel_id,
        channel.channel_subscribed !== true,
      );
      assertResponse(response);
      refresh();
    } catch (caught) {
      setError(errorMessage(caught, 'Subscription update failed'));
    } finally {
      setPending(false);
    }
  };
  const subscribers = new Intl.NumberFormat().format(channel.channel_subs);
  const refreshed = isoDate(channel.channel_last_refresh);
  const identity = (
    <Link
      className="flex min-h-10 min-w-0 items-center gap-3 rounded-sm hover:underline"
      to={NewRoutes.Channel(channel.channel_id)}
      title={channel.channel_name}
    >
      <img
        className="size-10 shrink-0 rounded-full object-cover"
        src={channel.channel_thumb_url}
        alt=""
        loading="lazy"
      />
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-semibold">{channel.channel_name}</h2>
        <p className={`text-xs text-muted-foreground ${view === 'table' ? 'sm:hidden' : ''}`}>
          <span>Subscribers: {subscribers}</span>
          {' · '}
          <span>Last refreshed: {refreshed}</span>
        </p>
      </div>
    </Link>
  );
  const action = admin && (
    <div className="shrink-0">
      <Button
        className="min-h-10"
        variant={channel.channel_subscribed ? 'secondary' : 'default'}
        size="sm"
        disabled={pending}
        onClick={() => void toggle()}
        aria-label={`${channel.channel_subscribed ? 'Unsubscribe from' : 'Subscribe to'} ${channel.channel_name}`}
      >
        {pending ? 'Saving…' : channel.channel_subscribed ? 'Unsubscribe' : 'Subscribe'}
      </Button>
      {error && (
        <p className="max-w-48 whitespace-normal text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
  if (view === 'table') {
    return (
      <TableRow>
        <TableCell className="whitespace-normal">{identity}</TableCell>
        <TableCell className="hidden sm:table-cell">{subscribers}</TableCell>
        <TableCell className="hidden sm:table-cell">{refreshed}</TableCell>
        {admin && <TableCell className="text-right">{action}</TableCell>}
      </TableRow>
    );
  }
  return (
    <CollectionItem
      compact={view !== 'grid'}
      media={
        <Link
          to={NewRoutes.Channel(channel.channel_id)}
          aria-label={`Open ${channel.channel_name}`}
        >
          <CollectionImage src={channel.channel_thumb_url} compact={view !== 'grid'} avatar />
        </Link>
      }
      title={
        <Link to={NewRoutes.Channel(channel.channel_id)} title={channel.channel_name}>
          {channel.channel_name}
        </Link>
      }
      metadata={
        <>
          <span>Subscribers: {subscribers}</span>
          <span>Last refreshed: {refreshed}</span>
        </>
      }
      actions={action}
    />
  );
}
