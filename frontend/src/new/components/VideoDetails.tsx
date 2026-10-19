import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { VideoResponseType } from '../../api/loader/loadVideoById';
import type { ChannelType } from '../../pages/Channels';
import useIsAdmin from '../../functions/useIsAdmin';
import updateChannelSubscription from '../../api/actions/updateChannelSubscription';
import { useUserConfigStore } from '../../stores/UserConfigStore';
import { FileSizeUnits } from '../../api/actions/updateUserConfig';
import formatNumbers from '../../functions/formatNumbers';
import humanFileSize from '../../functions/humanFileSize';
import bitsToBytes from '../../functions/bitsToBytes';
import capitalizeFirstLetter from '../../functions/capitalizeFirstLetter';
import { PlayerText } from './Comments';
import Routes from '../routes';
import getApiUrl from '../../configuration/getApiUrl';
import { playerMediaUrl } from '../lib/player';
import { isoDate } from '../videoMetadata';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';

export default function VideoDetails({
  video,
  onSeek,
  onRefresh,
}: {
  video: VideoResponseType;
  onSeek: (seconds: number) => void;
  onRefresh: () => void;
}) {
  const isAdmin = useIsAdmin();
  const { userConfig } = useUserConfigStore();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const channel = video.channel as ChannelType;
  const metric = userConfig.file_size_unit === FileSizeUnits.Metric;
  const run = async (operation: () => Promise<{ status: number; error?: { error: string } }>) => {
    setBusy(true);
    setError('');
    try {
      const response = await operation();
      if (response.status < 200 || response.status >= 300 || response.error)
        throw new Error(response.error?.error ?? `Request failed (${response.status})`);
      onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Video details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Link
              to={Routes.Channel(channel.channel_id)}
              aria-label={`${channel.channel_name} channel`}
            >
              <img
                className="size-12 rounded-full object-cover"
                src={playerMediaUrl(channel.channel_thumb_url, getApiUrl())}
                alt=""
              />
            </Link>
            <Link
              to={Routes.ChannelVideo(channel.channel_id)}
              className="font-semibold text-foreground underline"
            >
              {channel.channel_name}
            </Link>
            <span>
              {channel.channel_subs == null
                ? ''
                : `${formatNumbers(channel.channel_subs)} subscribers`}
            </span>
            {isAdmin && (
              <Button
                variant={channel.channel_subscribed ? 'secondary' : 'default'}
                size="sm"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    updateChannelSubscription(channel.channel_id, !channel.channel_subscribed),
                  )
                }
              >
                {channel.channel_subscribed ? 'Unsubscribe' : 'Subscribe'}
              </Button>
            )}
          </div>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <dt>Published</dt>
            <dd>{isoDate(video.published)}</dd>
            <dt>Last refreshed</dt>
            <dd>{isoDate(video.vid_last_refresh)}</dd>
            <dt>Watched</dt>
            <dd>{video.player.watched ? 'Yes' : 'No'}</dd>
            <dt>YouTube</dt>
            <dd>
              {video.active ? (
                <a
                  className="underline"
                  href={`https://www.youtube.com/watch?v=${video.youtube_id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Active
                </a>
              ) : (
                'Deactivated'
              )}
            </dd>
            <dt>Views</dt>
            <dd>{formatNumbers(video.stats.view_count)}</dd>
            <dt>Likes</dt>
            <dd>{formatNumbers(video.stats.like_count)}</dd>
            {video.stats.dislike_count > 0 && (
              <>
                <dt>Dislikes</dt>
                <dd>{formatNumbers(video.stats.dislike_count)}</dd>
              </>
            )}
            <dt>Rating</dt>
            <dd>{video.stats.average_rating}</dd>
            {video.media_size != null && (
              <>
                <dt>File size</dt>
                <dd>{humanFileSize(video.media_size, metric)}</dd>
              </>
            )}
          </dl>
          {video.streams?.map(stream => (
            <p key={stream.index} className="text-sm">
              {capitalizeFirstLetter(stream.type)}: {stream.codec}{' '}
              {humanFileSize(bitsToBytes(stream.bitrate), metric)}/s
              {stream.width ? ` · ${stream.width}×${stream.height}` : ''}
            </p>
          ))}
          {!!video.tags?.length && (
            <div className="flex flex-wrap gap-2">
              {video.tags.map(tag => (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
          {video.description && (
            <div>
              <p className={expanded ? 'whitespace-pre-wrap' : 'line-clamp-4 whitespace-pre-wrap'}>
                <PlayerText onSeek={onSeek}>{video.description}</PlayerText>
              </p>
              <Button
                variant="link"
                aria-expanded={expanded}
                className="px-0 text-foreground"
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? 'Show less' : 'Show more'}
              </Button>
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-foreground">
              {error}{' '}
              <Button
                variant="default"
                onClick={() =>
                  run(() =>
                    updateChannelSubscription(channel.channel_id, !channel.channel_subscribed),
                  )
                }
              >
                Retry
              </Button>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
