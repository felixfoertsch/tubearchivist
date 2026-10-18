import { useConfirm } from './useConfirm';
import { useState } from 'react';
import NewRoutes from '../routes';
import { Link } from 'react-router-dom';
import type { VideoType } from '../../pages/Home';
import { useUserConfigStore } from '../../stores/UserConfigStore';
import useIsAdmin from '../../functions/useIsAdmin';
import updateDownloadQueue from '../../api/actions/updateDownloadQueue';
import queueReindex from '../../api/actions/queueReindex';
import updateCustomPlaylist from '../../api/actions/updateCustomPlaylist';
import humanFileSize from '../../functions/humanFileSize';
import { FileSizeUnits } from '../../api/actions/updateUserConfig';
import VideoCard from './VideoCard';
import { Collection } from './Collection';
import { togglePageSelection } from './BulkSelection';
import { errorMessage, assertResponse } from '../videoMetadata';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../ui/table';
import { NativeSelect } from '../ui/native-select';

export function VideoCollection({
  videos,
  refresh,
  playlistId,
  reorder = false,
  view,
  bulk = true,
  loading = false,
}: {
  videos: VideoType[];
  refresh: () => void;
  playlistId?: string;
  reorder?: boolean;
  view?: string;
  bulk?: boolean;
  loading?: boolean;
}) {
  const { confirm, dialog } = useConfirm();
  const { userConfig } = useUserConfigStore();
  const isAdmin = useIsAdmin();
  const style = view ?? userConfig.view_style_home;
  const [selection, setSelection] = useState<string[]>([]);
  const [showSelection, setShowSelection] = useState(false);
  const [action, setAction] = useState('reindex');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const toggle = (id: string) =>
    setSelection(ids => (ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]));
  const checkbox = (video: VideoType) =>
    showSelection && (
      <label className="flex items-center gap-2 text-xs">
        <Checkbox
          checked={selection.includes(video.youtube_id)}
          onCheckedChange={() => toggle(video.youtube_id)}
          disabled={pending}
          aria-label={`Select ${video.title}`}
        />
        Select
      </label>
    );
  const apply = async () => {
    if (!isAdmin || pending || !selection.length) return;
    const ids = [...selection];
    const operation = action;
    setPending(true);
    setError('');
    setMessage('');
    try {
      if (
        !(await confirm({
          title: `${operation === 'redownload' ? 'Redownload' : 'Reindex'} selected videos?`,
          description: `Apply this action to ${ids.length} selected videos.`,
          actionLabel: operation === 'redownload' ? 'Redownload' : 'Reindex',
        }))
      )
        return;
      assertResponse(
        await (operation === 'redownload'
          ? updateDownloadQueue({
              youtubeIdStrings: ids.join('\n'),
              autostart: true,
              force: true,
            })
          : queueReindex(ids, 'video')),
      );
      setSelection([]);
      setMessage('Task scheduled.');
      refresh();
    } catch (caught) {
      setError(errorMessage(caught, 'Bulk action failed'));
    } finally {
      setPending(false);
    }
  };
  const reorderVideo = async (
    video: VideoType,
    direction: 'top' | 'up' | 'down' | 'bottom' | 'remove',
  ) => {
    if (!isAdmin || !playlistId || pending) return;
    const targetPlaylist = playlistId;
    const targetVideo = video.youtube_id;
    const title = video.title;
    setPending(true);
    setError('');
    try {
      if (
        direction === 'remove' &&
        !(await confirm({
          title: 'Remove video?',
          description: `Remove ${title} from playlist?`,
          actionLabel: 'Remove',
        }))
      )
        return;
      assertResponse(await updateCustomPlaylist(direction, targetPlaylist, targetVideo));
      refresh();
    } catch (caught) {
      setError(errorMessage(caught, 'Could not reorder playlist'));
    } finally {
      setPending(false);
    }
  };
  const useSi = userConfig.file_size_unit === FileSizeUnits.Metric;
  return (
    <div className="space-y-3">
      {dialog}
      {bulk && isAdmin && (
        <fieldset disabled={pending} className="flex flex-wrap items-center gap-2 text-sm">
          <Button variant="outline" size="sm" onClick={() => setShowSelection(value => !value)}>
            {showSelection ? 'Hide selection' : 'Select videos'}
          </Button>
          {showSelection && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setSelection(ids =>
                    togglePageSelection(
                      ids,
                      videos.map(video => video.youtube_id),
                    ),
                  )
                }
              >
                Select / clear page
              </Button>
              <span>{selection.length.toLocaleString()} selected</span>
              <Button variant="ghost" size="sm" onClick={() => setSelection([])}>
                Clear
              </Button>
              <NativeSelect
                aria-label="Bulk action"
                value={action}
                onChange={e => setAction(e.target.value)}
              >
                <option value="reindex">Reindex</option>
                <option value="redownload">Redownload</option>
              </NativeSelect>
              <Button
                variant="outline"
                size="sm"
                disabled={!selection.length}
                onClick={() => void apply()}
              >
                {pending ? 'Scheduling…' : 'Apply'}
              </Button>
            </>
          )}
        </fieldset>
      )}
      {error && (
        <p role="alert" className="text-foreground">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {style === 'table' ? (
        <div className="overflow-x-auto rounded-xl border">
          <Table className="w-full text-left text-xs">
            <TableHeader className="bg-muted">
              <TableRow>
                {[
                  ...(showSelection ? ['Select'] : []),
                  'Title',
                  'Channel',
                  'Type',
                  'Resolution',
                  'Media size',
                  'Video codec',
                  'Video bitrate',
                  'Audio codec',
                  'Audio bitrate',
                  ...(isAdmin && reorder && playlistId ? ['Playlist order'] : []),
                ].map(title => (
                  <TableHead key={title} className="whitespace-nowrap p-2 font-medium">
                    {title}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {videos.map(video => {
                const videoStream = video.streams?.find(stream => stream.type === 'video');
                const audioStream = video.streams?.find(stream => stream.type === 'audio');
                return (
                  <TableRow key={video.youtube_id} className="border-t align-top">
                    {showSelection && <TableCell className="p-2">{checkbox(video)}</TableCell>}
                    <TableCell className="min-w-48 max-w-md p-2">
                      <Link
                        className="line-clamp-3 hover:underline"
                        to={NewRoutes.Video(video.youtube_id)}
                      >
                        {video.title}
                      </Link>
                    </TableCell>
                    <TableCell className="min-w-28 p-2">
                      <Link to={NewRoutes.Channel(video.channel.channel_id)}>
                        {video.channel.channel_name}
                      </Link>
                    </TableCell>
                    {[
                      video.vid_type,
                      `${videoStream?.width || '-'}×${videoStream?.height || '-'}`,
                      humanFileSize(video.media_size, useSi),
                      videoStream?.codec || '-',
                      `${humanFileSize((videoStream?.bitrate || 0) / 8, useSi)}/s`,
                      audioStream?.codec || '-',
                      `${humanFileSize((audioStream?.bitrate || 0) / 8, useSi)}/s`,
                    ].map((value, index) => (
                      <TableCell key={index} className="whitespace-nowrap p-2">
                        {value}
                      </TableCell>
                    ))}
                    {isAdmin && reorder && playlistId && (
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {(['top', 'up', 'down', 'bottom', 'remove'] as const).map(direction => (
                            <Button
                              key={direction}
                              size="sm"
                              variant="outline"
                              disabled={pending}
                              onClick={() => void reorderVideo(video, direction)}
                            >
                              {direction === 'remove' ? 'Remove' : `Move ${direction}`}
                            </Button>
                          ))}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <Collection grid={style === 'grid'}>
          {videos.map(video => (
            <VideoCard
              key={video.youtube_id}
              video={video}
              refresh={refresh}
              compact={style !== 'grid'}
              playlistId={playlistId}
              reorder={reorder}
              selection={checkbox(video)}
            />
          ))}
        </Collection>
      )}
      {loading ? <p role="status">Loading videos…</p> : !videos.length && <p>No videos found.</p>}
    </div>
  );
}

export default VideoCollection;
