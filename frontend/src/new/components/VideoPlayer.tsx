import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { VideoResponseType } from '../../api/loader/loadVideoById';
import type { SponsorBlockType } from '../../pages/Video';
import updateVideoProgressById from '../../api/actions/updateVideoProgressById';
import getApiUrl from '../../configuration/getApiUrl';
import formatTime from '../../functions/formatTime';
import { Button } from '../ui/button';
import { NativeSelect, NativeSelectOption } from '../ui/native-select';
import {
  PLAYER_SPEEDS,
  playerEditable,
  playerMediaUrl,
  playerPosition,
  playerTimestamp,
  playerProgressDue,
  playerProgressQueue,
  playerSponsorSegment,
} from '../lib/player';

type VideoPlayerProps = {
  video: VideoResponseType;
  sponsorBlock?: SponsorBlockType;
  embed?: boolean;
  autoplay?: boolean;
  onWatchStateChanged?: (status: boolean) => void;
  onVideoEnd?: () => void;
  seekToTimestamp?: number;
  setSeekToTimestamp?: (timestamp: number | undefined) => void;
};

export default function VideoPlayer(props: VideoPlayerProps) {
  // Reset media-owned state only when video changes, not when metadata refreshes.
  return <Player key={props.video.youtube_id} {...props} />;
}

function Player({
  video,
  sponsorBlock = video.sponsorblock,
  embed = false,
  autoplay = false,
  onWatchStateChanged,
  onVideoEnd,
  seekToTimestamp,
  setSeekToTimestamp,
}: VideoPlayerProps) {
  const media = useRef<HTMLVideoElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [query] = useSearchParams();
  const timestamp = query.get('t');
  const initialPosition = useRef(playerTimestamp(timestamp, playerPosition(video.player.position)));
  const previousTimestamp = useRef(timestamp);
  const callbacks = useRef({ onWatchStateChanged, onVideoEnd, watched: video.player.watched });
  const [speed, setSpeed] = useState(() => {
    const value = Number(localStorage.getItem('playerSpeed') ?? 1);
    return PLAYER_SPEEDS.includes(value) ? value : 1;
  });
  const [theater, setTheater] = useState(false);
  const [help, setHelp] = useState(false);
  const [error, setError] = useState('');
  const [progressError, setProgressError] = useState('');
  const [skipped, setSkipped] = useState<{ from: number; to: number }>();
  const [subtitle, setSubtitle] = useState(-1);
  const lastSubtitle = useRef(0);
  const lastBucket = useRef(-1);
  const endedHandled = useRef(false);
  const alive = useRef(true);
  const base = getApiUrl();
  const src = playerMediaUrl(video.media_url, base);
  const poster = playerMediaUrl(video.vid_thumb_url, base);

  useEffect(() => {
    callbacks.current = { onWatchStateChanged, onVideoEnd, watched: video.player.watched };
  }, [onWatchStateChanged, onVideoEnd, video.player.watched]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const queueProgress = useRef<ReturnType<typeof playerProgressQueue> | null>(null);
  useEffect(() => {
    queueProgress.current = playerProgressQueue(
      async position => {
        const response = await updateVideoProgressById({
          youtubeId: video.youtube_id,
          currentProgress: position,
        });
        if (response.status < 200 || response.status >= 300 || response.error)
          throw new Error('Progress could not be saved.');
        if (alive.current && response.data?.watched && !callbacks.current.watched) {
          callbacks.current.watched = true;
          callbacks.current.onWatchStateChanged?.(true);
        }
      },
      () => alive.current,
    );
    return () => {
      queueProgress.current = null;
    };
  }, [video.youtube_id]);

  const save = useCallback(async (position: number) => {
    try {
      await queueProgress.current?.(position);
      if (!alive.current) return;
      setProgressError('');
      if (media.current?.ended && !endedHandled.current) {
        endedHandled.current = true;
        callbacks.current.onVideoEnd?.();
      }
    } catch {
      if (alive.current) setProgressError('Progress could not be saved. Retry before leaving.');
    }
  }, []);

  const play = useCallback(async () => {
    try {
      await media.current?.play();
      setError('');
    } catch {
      setError(
        'Playback did not start. Select Play to retry; browser may have blocked autoplay or media may be unavailable.',
      );
    }
  }, []);

  const fullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await container.current?.requestFullscreen();
    } catch {
      setError('Fullscreen unavailable. Try native player fullscreen control.');
    }
  }, []);

  const selectSubtitle = useCallback((index: number) => {
    const tracks = media.current?.textTracks;
    if (!tracks) return;
    Array.from(tracks).forEach((track, i) => {
      track.mode = i === index ? 'showing' : 'disabled';
    });
    if (index >= 0) lastSubtitle.current = index;
    setSubtitle(index);
  }, []);

  useEffect(() => {
    const tracks = media.current?.textTracks;
    if (!tracks) return;
    const changed = () => {
      const index = Array.from(tracks).findIndex(track => track.mode === 'showing');
      setSubtitle(index);
      if (index >= 0) lastSubtitle.current = index;
    };
    tracks.addEventListener('change', changed);
    return () => tracks.removeEventListener('change', changed);
  }, []);

  useEffect(() => {
    const element = media.current;
    if (!element) return;
    const seek = () => {
      const queryPosition =
        previousTimestamp.current !== timestamp ? playerTimestamp(timestamp, NaN) : undefined;
      const requestedSeek =
        seekToTimestamp ?? (Number.isFinite(queryPosition) ? queryPosition : undefined);
      if (requestedSeek === undefined || !Number.isFinite(element.duration)) return;
      if (
        !Number.isFinite(requestedSeek) ||
        requestedSeek < 0 ||
        requestedSeek > element.duration
      ) {
        setError('Timestamp outside video duration. Choose another timestamp.');
        setSeekToTimestamp?.(undefined);
        previousTimestamp.current = timestamp;
        return;
      }
      element.currentTime = requestedSeek;
      setSeekToTimestamp?.(undefined);
      previousTimestamp.current = timestamp;
      void play();
      container.current?.scrollIntoView({ block: 'start' });
    };
    seek();
    element.addEventListener('loadedmetadata', seek);
    return () => element.removeEventListener('loadedmetadata', seek);
  }, [timestamp, seekToTimestamp, setSeekToTimestamp, play]);

  useEffect(() => {
    const element = media.current;
    if (!element) return;
    const keyboard = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey || playerEditable(event.target)) return;
      const changeSpeed = (value: number) => {
        element.playbackRate = value;
      };
      switch (event.key) {
        case 'p':
          if (element.paused) void play();
          else element.pause();
          break;
        case 'm':
          element.muted = !element.muted;
          break;
        case 'f':
          void fullscreen();
          break;
        case 't':
          if (!embed) setTheater(value => !value);
          break;
        case 'Escape':
          setTheater(false);
          break;
        case '?':
          setHelp(value => !value);
          break;
        case 'c':
          selectSubtitle(
            Array.from(element.textTracks).some(track => track.mode === 'showing')
              ? -1
              : lastSubtitle.current,
          );
          break;
        case 'ArrowLeft':
          element.currentTime = Math.max(0, element.currentTime - 5);
          break;
        case 'ArrowRight':
          element.currentTime = Math.min(element.duration || Infinity, element.currentTime + 5);
          break;
        case '>':
          changeSpeed(
            PLAYER_SPEEDS[
              Math.min(PLAYER_SPEEDS.length - 1, PLAYER_SPEEDS.indexOf(element.playbackRate) + 1)
            ],
          );
          break;
        case '<':
          changeSpeed(PLAYER_SPEEDS[Math.max(0, PLAYER_SPEEDS.indexOf(element.playbackRate) - 1)]);
          break;
        case '=':
          changeSpeed(1);
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [embed, fullscreen, play, selectSubtitle]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    // Media Session is mutable browser state, not React-owned data.
    // eslint-disable-next-line react-hooks/immutability
    session.metadata = new MediaMetadata({
      title: video.title,
      artist: video.channel.channel_name,
      artwork: poster ? [{ src: poster }] : [],
    });
    const actions: [MediaSessionAction, MediaSessionActionHandler][] = [
      [
        'play',
        () => {
          void play();
        },
      ],
      ['pause', () => media.current?.pause()],
      [
        'seekbackward',
        details => {
          if (media.current)
            media.current.currentTime = Math.max(
              0,
              media.current.currentTime - (details.seekOffset ?? 5),
            );
        },
      ],
      [
        'seekforward',
        details => {
          if (media.current)
            media.current.currentTime = Math.min(
              media.current.duration,
              media.current.currentTime + (details.seekOffset ?? 5),
            );
        },
      ],
      [
        'seekto',
        details => {
          if (media.current && details.seekTime !== undefined)
            media.current.currentTime = Math.min(
              media.current.duration,
              playerPosition(details.seekTime),
            );
        },
      ],
    ];
    const registered: MediaSessionAction[] = [];
    actions.forEach(([action, handler]) => {
      try {
        session.setActionHandler(action, handler);
        registered.push(action);
      } catch {
        /* Browser may support only some actions. */
      }
    });
    return () => {
      registered.forEach(action => session.setActionHandler(action, null));
      session.metadata = null;
      session.playbackState = 'none';
    };
  }, [video.title, video.channel.channel_name, poster, play]);

  if (!src) return <p role="alert">Invalid video media URL.</p>;
  return (
    <section className="space-y-3" aria-label="Video player">
      <div
        ref={container}
        className={
          theater
            ? 'fixed inset-0 z-50 flex flex-col justify-center overflow-auto bg-background p-2'
            : 'overflow-hidden rounded-xl border bg-black'
        }
      >
        <video
          ref={media}
          aria-label={video.title}
          className={theater ? 'max-h-[85dvh] w-full' : 'max-h-[75dvh] w-full'}
          src={src}
          poster={poster}
          controls
          playsInline
          crossOrigin="use-credentials"
          onLoadedMetadata={event => {
            const element = event.currentTarget;
            element.volume = Math.min(
              1,
              playerPosition(localStorage.getItem('playerVolume') ?? 1, 1),
            );
            element.playbackRate = speed;
            element.currentTime = Math.min(element.duration || Infinity, initialPosition.current);
            if (autoplay) void play();
          }}
          onVolumeChange={event =>
            localStorage.setItem('playerVolume', String(event.currentTarget.volume))
          }
          onRateChange={event => {
            setSpeed(event.currentTarget.playbackRate);
            localStorage.setItem('playerSpeed', String(event.currentTarget.playbackRate));
          }}
          onTimeUpdate={event => {
            const element = event.currentTarget;
            const time = element.currentTime;
            const segment = playerSponsorSegment(time, sponsorBlock);
            if (segment) {
              element.currentTime = Math.min(element.duration, segment.segment[1]);
              setSkipped({ from: segment.segment[0], to: segment.segment[1] });
            } else if (skipped && time > skipped.to + 10) setSkipped(undefined);
            if (playerProgressDue(time, element.duration, lastBucket.current)) {
              lastBucket.current = Math.floor(time / 10);
              void save(time);
            }
            if (
              'mediaSession' in navigator &&
              Number.isFinite(element.duration) &&
              element.duration > 0
            ) {
              try {
                navigator.mediaSession.setPositionState({
                  duration: element.duration,
                  playbackRate: element.playbackRate,
                  position: Math.min(element.duration, time),
                });
              } catch {
                /* Partial Media Session implementations omit position state. */
              }
            }
          }}
          onPlay={() => {
            endedHandled.current = false;
            if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
          }}
          onPause={event => {
            if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
            const element = event.currentTarget;
            if (element.currentTime >= 10 && element.currentTime <= element.duration * 0.95)
              void save(element.currentTime);
          }}
          onEnded={async event => {
            setSkipped(undefined);
            await save(event.currentTarget.currentTime);
          }}
          onError={() => setError('Video could not be loaded. Check connection and retry.')}
        >
          {video.subtitles?.map((track, index) => {
            const url = playerMediaUrl(track.media_url, base);
            return url ? (
              <track
                key={`${track.lang}-${index}`}
                kind="subtitles"
                src={url}
                srcLang={track.lang}
                label={`${track.name}${track.source === 'auto' ? ' - auto' : ''}`}
              />
            ) : null;
          })}
        </video>
        <div className="flex flex-wrap items-center gap-2 bg-background p-3 text-foreground">
          <label className="flex items-center gap-2 text-sm">
            Speed
            <NativeSelect
              aria-label="Playback speed"
              value={speed}
              onChange={event => {
                if (media.current) media.current.playbackRate = Number(event.target.value);
              }}
            >
              {PLAYER_SPEEDS.map(value => (
                <NativeSelectOption key={value} value={value}>
                  {value.toLocaleString()}×
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label className="flex items-center gap-2 text-sm">
            Subtitles
            <NativeSelect
              aria-label="Subtitles"
              value={subtitle}
              onChange={event => selectSubtitle(Number(event.target.value))}
            >
              <NativeSelectOption value={-1}>Off</NativeSelectOption>
              {video.subtitles
                ?.filter(track => playerMediaUrl(track.media_url, base))
                .map((track, index) => (
                  <NativeSelectOption key={`${track.lang}-${index}`} value={index}>
                    {track.name}
                    {track.source === 'auto' ? ' - auto' : ''}
                  </NativeSelectOption>
                ))}
            </NativeSelect>
          </label>
          {!embed && (
            <Button
              variant={theater ? 'secondary' : 'outline'}
              onClick={() => setTheater(value => !value)}
            >
              {theater ? 'Exit theater' : 'Theater'}
            </Button>
          )}
          <Button variant="outline" onClick={() => void fullscreen()}>
            Fullscreen
          </Button>
          {'pictureInPictureEnabled' in document && document.pictureInPictureEnabled && (
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  if (document.pictureInPictureElement) await document.exitPictureInPicture();
                  else await media.current?.requestPictureInPicture();
                } catch {
                  setError('Picture-in-picture unavailable for this video.');
                }
              }}
            >
              Picture-in-picture
            </Button>
          )}
          <Button variant="ghost" aria-expanded={help} onClick={() => setHelp(value => !value)}>
            Keyboard help
          </Button>
        </div>
      </div>
      {help && (
        <div className="rounded-lg border p-4 text-sm">
          <h2 className="font-semibold">Keyboard shortcuts</h2>
          <p>
            p: play/pause · m: mute · f: fullscreen · c: subtitles · ← / →: seek 5 seconds · &lt; /
            &gt;: speed · =: normal speed · ?: help
            {!embed && ' · t: theater · Escape: exit theater'}
          </p>
          <Button variant="ghost" onClick={() => setHelp(false)}>
            Close help
          </Button>
        </div>
      )}
      {error && (
        <div role="alert" className="rounded-lg border border-destructive p-3">
          <p>{error}</p>
          <Button
            variant="default"
            onClick={() => {
              if (media.current?.error) media.current.load();
              void play();
            }}
          >
            Play / Retry
          </Button>
        </div>
      )}
      {progressError && (
        <div role="alert" className="rounded-lg border border-destructive p-3">
          <p>{progressError}</p>
          <Button
            variant="default"
            onClick={async () => {
              await save(media.current?.currentTime ?? 0);
            }}
          >
            Retry saving progress
          </Button>
        </div>
      )}
      {sponsorBlock?.is_enabled && (
        <aside className="space-y-2 rounded-lg border p-3 text-sm" aria-label="SponsorBlock">
          {sponsorBlock.segments.length === 0 && (
            <p>
              No sponsor segments. Add segments using{' '}
              <a
                className="underline"
                href="https://sponsor.ajay.app/"
                target="_blank"
                rel="noreferrer"
              >
                SponsorBlock
              </a>{' '}
              on{' '}
              <a
                className="underline"
                href={`https://www.youtube.com/watch?v=${video.youtube_id}`}
                target="_blank"
                rel="noreferrer"
              >
                YouTube
              </a>
              .
            </p>
          )}
          {sponsorBlock.has_unlocked && (
            <p>
              Unlocked sponsor segments. Vote using{' '}
              <a
                className="underline"
                href="https://sponsor.ajay.app/"
                target="_blank"
                rel="noreferrer"
              >
                SponsorBlock
              </a>{' '}
              on{' '}
              <a
                className="underline"
                href={`https://www.youtube.com/watch?v=${video.youtube_id}`}
                target="_blank"
                rel="noreferrer"
              >
                YouTube
              </a>
              .
            </p>
          )}
          {skipped && (
            <p role="status">
              Skipped sponsor segment from {formatTime(skipped.from)} to {formatTime(skipped.to)}.
            </p>
          )}
        </aside>
      )}
    </section>
  );
}
