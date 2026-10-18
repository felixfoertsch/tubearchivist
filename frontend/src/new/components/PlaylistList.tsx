import { useState } from 'react';
import { Link } from 'react-router-dom';
import NewRoutes from '../routes';
import { assertResponse, errorMessage, isoDate } from '../videoMetadata';
import type { PlaylistType } from '../../api/loader/loadPlaylistById';
import updatePlaylistSubscription from '../../api/actions/updatePlaylistSubscription';
import useIsAdmin from '../../functions/useIsAdmin';
import { useUserConfigStore } from '../../stores/UserConfigStore';
import { Button } from '../ui/button';
import { Card } from '../ui/card';

export function PlaylistList({
  playlists,
  refresh,
}: {
  playlists: PlaylistType[];
  refresh: () => void;
}) {
  const { userConfig } = useUserConfigStore();
  const view = userConfig.view_style_playlist;
  const grid =
    view === 'grid'
      ? 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-[repeat(var(--playlist-columns),minmax(0,1fr))]'
      : 'flex flex-col gap-3';
  return (
    <div
      className={grid}
      style={{ ['--playlist-columns' as string]: Math.min(7, Math.max(3, userConfig.grid_items)) }}
    >
      {playlists.map(playlist => (
        <PlaylistListItem
          key={playlist.playlist_id}
          playlist={playlist}
          refresh={refresh}
          view={view}
        />
      ))}
    </div>
  );
}

function PlaylistListItem({
  playlist,
  refresh,
  view,
}: {
  playlist: PlaylistType;
  refresh: () => void;
  view: string;
}) {
  const isAdmin = useIsAdmin();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const subscribed = async (value: boolean) => {
    setPending(true);
    setError('');
    try {
      const response = await updatePlaylistSubscription(playlist.playlist_id, value);
      assertResponse(response);
      refresh();
    } catch (caught) {
      setError(errorMessage(caught, 'Subscription update failed'));
    } finally {
      setPending(false);
    }
  };
  const playlistHref = NewRoutes.Playlist(playlist.playlist_id);
  return (
    <Card className={`gap-0 overflow-hidden py-0 ${view === 'list' ? 'sm:flex-row' : ''}`}>
      <Link to={playlistHref} aria-label={`Open ${playlist.playlist_name}`}>
        <img
          className={`aspect-video w-full object-cover ${view === 'list' ? 'sm:h-28 sm:w-48' : ''}`}
          src={playlist.playlist_thumbnail || '/img/default-playlist-thumb.jpg'}
          alt=""
        />
      </Link>
      <div className="min-w-0 flex-1 space-y-2 p-3">
        {playlist.playlist_type !== 'custom' && (
          <Link
            className="text-xs text-muted-foreground hover:underline"
            to={NewRoutes.Channel(playlist.playlist_channel_id)}
          >
            {playlist.playlist_channel}
          </Link>
        )}
        <h2 className="font-semibold">
          <Link to={playlistHref} className="hover:underline">
            {playlist.playlist_name}
          </Link>
        </h2>
        <p className="text-xs text-muted-foreground">
          Last refreshed: {isoDate(playlist.playlist_last_refresh)}
        </p>
        {playlist.playlist_type !== 'custom' && isAdmin && (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => void subscribed(!playlist.playlist_subscribed)}
          >
            {pending
              ? 'Saving…'
              : playlist.playlist_subscribed
                ? 'Unsubscribe playlist'
                : 'Subscribe playlist'}
          </Button>
        )}
        {error && (
          <p role="alert" className="text-sm text-foreground">
            {error}
          </p>
        )}
      </div>
    </Card>
  );
}

export default PlaylistList;
