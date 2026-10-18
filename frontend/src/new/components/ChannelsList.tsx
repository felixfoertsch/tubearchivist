import { useState } from 'react';
import { Link } from 'react-router-dom';
import updateChannelSubscription from '../../api/actions/updateChannelSubscription';
import useIsAdmin from '../../functions/useIsAdmin';
import type { ChannelType } from '../../pages/Channels';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { useUserConfigStore } from '../../stores/UserConfigStore';
import { assertResponse, errorMessage, isoDate } from '../videoMetadata';
import NewRoutes from '../routes';

export function ChannelsList({
  channels,
  refresh,
}: {
  channels: ChannelType[];
  refresh: () => void;
}) {
  const admin = Boolean(useIsAdmin());
  const view = useUserConfigStore(state => state.userConfig.view_style_channel);
  const grid =
    view === 'grid'
      ? 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'
      : 'flex flex-col gap-3';
  return (
    <div className={grid}>
      {channels.map(channel => (
        <ChannelCard key={channel.channel_id} channel={channel} refresh={refresh} admin={admin} />
      ))}
    </div>
  );
}

function ChannelCard({
  channel,
  refresh,
  admin,
}: {
  channel: ChannelType;
  refresh: () => void;
  admin: boolean;
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
  return (
    <Card className="gap-2 overflow-hidden p-0">
      <Link to={NewRoutes.Channel(channel.channel_id)} aria-label={`Open ${channel.channel_name}`}>
        <img
          className="aspect-video w-full object-cover"
          src={channel.channel_banner_url || channel.channel_thumb_url}
          alt=""
        />
      </Link>
      <div className="space-y-2 p-3">
        <h2 className="font-semibold">
          <Link className="hover:underline" to={NewRoutes.Channel(channel.channel_id)}>
            {channel.channel_name}
          </Link>
        </h2>
        <p className="text-sm">
          Subscribers: {new Intl.NumberFormat().format(channel.channel_subs)} · Last refreshed:{' '}
          {isoDate(channel.channel_last_refresh)}
        </p>
        {admin && (
          <Button
            variant={channel.channel_subscribed ? 'outline' : 'secondary'}
            size="sm"
            disabled={pending}
            onClick={() => void toggle()}
          >
            {pending ? 'Saving…' : channel.channel_subscribed ? 'Unsubscribe' : 'Subscribe'}
          </Button>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </Card>
  );
}
