import { useState } from 'react';
import { Link } from 'react-router-dom';
import NewRoutes from '../routes';
import { assertResponse, errorMessage, isoDate } from '../videoMetadata';
import type { PlaylistType } from '../../api/loader/loadPlaylistById';
import updatePlaylistSubscription from '../../api/actions/updatePlaylistSubscription';
import useIsAdmin from '../../functions/useIsAdmin';
import { useUserConfigStore } from '../../stores/UserConfigStore';
import { Button } from '../ui/button';
import { Collection, CollectionImage, CollectionItem } from './Collection';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';

export function PlaylistList({
  playlists,
  refresh,
}: {
  playlists: PlaylistType[];
  refresh: () => void;
}) {
  const { userConfig } = useUserConfigStore();
  const view = userConfig.view_style_playlist;
  const rows = playlists.map(playlist => (
    <PlaylistListItem
      key={playlist.playlist_id}
      playlist={playlist}
      refresh={refresh}
      view={view}
    />
  ));
  return view === 'table' ? (
    <Table className="table-fixed" aria-label="Playlists">
      <TableHeader>
        <TableRow>
          <TableHead>Playlist</TableHead>
          <TableHead className="hidden w-36 sm:table-cell">Last refreshed</TableHead>
          <TableHead className="w-36">
            <span className="sr-only">Subscription</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>{rows}</TableBody>
    </Table>
  ) : (
    <Collection grid={view === 'grid'}>{rows}</Collection>
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
  const action = playlist.playlist_type !== 'custom' && isAdmin && (
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
  );
  if (view === 'table')
    return (
      <TableRow>
        <TableCell className="whitespace-normal">
          <Link
            className="flex min-h-10 min-w-0 items-center gap-3 text-sm font-semibold hover:underline"
            to={playlistHref}
            title={playlist.playlist_name}
          >
            <CollectionImage
              src={playlist.playlist_thumbnail || '/img/default-playlist-thumb.jpg'}
              compact
            />
            <span className="truncate">{playlist.playlist_name}</span>
          </Link>
          {error && <p role="alert">{error}</p>}
        </TableCell>
        <TableCell className="hidden sm:table-cell">
          {isoDate(playlist.playlist_last_refresh)}
        </TableCell>
        <TableCell>{action}</TableCell>
      </TableRow>
    );
  return (
    <CollectionItem
      compact={view !== 'grid'}
      media={
        <Link to={playlistHref} aria-label={`Open ${playlist.playlist_name}`}>
          <CollectionImage
            src={playlist.playlist_thumbnail || '/img/default-playlist-thumb.jpg'}
            compact={view !== 'grid'}
          />
        </Link>
      }
      title={
        <Link to={playlistHref} title={playlist.playlist_name}>
          {playlist.playlist_name}
        </Link>
      }
      metadata={
        <>
          {playlist.playlist_type !== 'custom' && (
            <Link to={NewRoutes.Channel(playlist.playlist_channel_id)}>
              {playlist.playlist_channel}
            </Link>
          )}
          <span>Last refreshed: {isoDate(playlist.playlist_last_refresh)}</span>
        </>
      }
      actions={action}
    >
      {error && (
        <p role="alert" className="text-sm text-foreground">
          {error}
        </p>
      )}
    </CollectionItem>
  );
}

export default PlaylistList;
