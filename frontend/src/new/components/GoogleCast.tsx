import { useEffect, useRef, useState, createElement } from 'react';
import type { VideoResponseType } from '../../api/loader/loadVideoById';
import updateVideoProgressById from '../../api/actions/updateVideoProgressById';
import getApiUrl from '../../configuration/getApiUrl';
import { playerCastStart, playerMediaUrl } from '../lib/player';
import { Button } from '../ui/button';

type CastMedia = { metadata: { title?: string; images?: unknown[] }; tracks?: unknown[] };
type CastRequest = { currentTime?: number };
type CastPlayer = {
  isConnected: boolean;
  currentTime: number;
  duration: number;
  mediaInfo?: { contentId: string };
};
type CastController = {
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};
type CastWindow = Window & {
  __onGCastApiAvailable?: (available: boolean) => void;
  cast?: {
    framework: {
      CastContext: {
        getInstance: () => {
          setOptions: (options: object) => void;
          getCurrentSession: () => { loadMedia: (request: CastRequest) => Promise<void> } | null;
          requestSession: () => Promise<void>;
        };
      };
      RemotePlayer: new () => CastPlayer;
      RemotePlayerController: new (player: CastPlayer) => CastController;
      RemotePlayerEventType: {
        IS_CONNECTED_CHANGED: string;
        CURRENT_TIME_CHANGED: string;
        IS_PAUSED_CHANGED: string;
      };
    };
  };
  chrome?: {
    cast: {
      AutoJoinPolicy: { ORIGIN_SCOPED: string };
      Image: new (url: string) => unknown;
      media: {
        DEFAULT_MEDIA_RECEIVER_APP_ID: string;
        MediaInfo: new (url: string, type: string) => CastMedia;
        GenericMediaMetadata: new () => CastMedia['metadata'];
        LoadRequest: new (media: CastMedia) => CastRequest;
        Track: new (
          id: number,
          type: string,
        ) => {
          trackContentId?: string;
          trackContentType?: string;
          subtype?: string;
          name?: string;
          language?: string;
        };
        TrackType: { TEXT: string };
        TextTrackType: { SUBTITLES: string };
      };
    };
  };
};

type Props = {
  video?: VideoResponseType;
  setRefresh?: () => void;
  onWatchStateChanged?: (status: boolean) => void;
};

export default function GoogleCast({ video, setRefresh, onWatchStateChanged }: Props) {
  const latest = useRef({ video, setRefresh, onWatchStateChanged });
  const mounted = useRef(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => {
    latest.current = { video, setRefresh, onWatchStateChanged };
  }, [video, setRefresh, onWatchStateChanged]);
  const castStart = useRef<ReturnType<typeof playerCastStart> | null>(null);
  const start = async () => {
    setPending(true);
    setError('');
    try {
      await castStart.current?.start();
    } catch {
      if (mounted.current)
        setError('Cast playback failed or was cancelled. Select Cast video to retry.');
    } finally {
      if (mounted.current) setPending(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    castStart.current = playerCastStart(
      async () => {
        const video = latest.current.video;
        const host = window as CastWindow;
        const framework = host.cast?.framework;
        const chrome = host.chrome?.cast;
        if (!video || !framework || !chrome) throw new Error('Cast unavailable.');
        const context = framework.CastContext.getInstance();
        const session = context.getCurrentSession();
        if (!session) throw new Error('No Cast session.');
        const url = playerMediaUrl(video.media_url, getApiUrl());
        if (!url) throw new Error('Invalid Cast media URL.');
        const info = new chrome.media.MediaInfo(url, 'video/mp4');
        info.metadata = new chrome.media.GenericMediaMetadata();
        info.metadata.title = video.title.replace('&amp;', '&');
        const image = playerMediaUrl(video.vid_thumb_url, getApiUrl());
        info.metadata.images = image ? [new chrome.Image(image)] : [];
        info.tracks = video.subtitles?.flatMap((subtitle, index) => {
          const url = playerMediaUrl(subtitle.media_url, getApiUrl());
          if (!url) return [];
          const track = new chrome.media.Track(index, chrome.media.TrackType.TEXT);
          track.trackContentId = url;
          track.trackContentType = 'text/vtt';
          track.subtype = chrome.media.TextTrackType.SUBTITLES;
          track.name = subtitle.name;
          track.language = subtitle.lang;
          return [track];
        });
        const request = new chrome.media.LoadRequest(info);
        request.currentTime = video.player.position > 5 ? video.player.position - 3 : 0;
        await session.loadMedia(request);
      },
      async () => {
        const context = (window as CastWindow).cast?.framework.CastContext.getInstance();
        if (!context) throw new Error('Cast unavailable.');
        if (!context.getCurrentSession()) await context.requestSession();
      },
      () => mounted.current,
    );

    const host = window as CastWindow;
    let disposed = false;
    let cleanup = () => {};
    let initialized = false;
    const previous = host.__onGCastApiAvailable;
    const setup = (available: boolean) => {
      if (!available || disposed || initialized || !host.cast || !host.chrome) return;
      initialized = true;
      const framework = host.cast.framework;
      framework.CastContext.getInstance().setOptions({
        receiverApplicationId: host.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
        autoJoinPolicy: host.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
      });
      const player = new framework.RemotePlayer();
      const controller = new framework.RemotePlayerController(player);
      let bucket = -1;
      let saving = false;
      const progress = async (paused = false) => {
        const current = latest.current;
        if (
          !current.video ||
          !player.mediaInfo?.contentId.includes(current.video.youtube_id) ||
          !player.duration ||
          player.currentTime <= 0 ||
          saving
        )
          return;
        const nextBucket = Math.floor(player.currentTime / 10);
        if (!paused && nextBucket === bucket) return;
        bucket = nextBucket;
        saving = true;
        try {
          const response = await updateVideoProgressById({
            youtubeId: current.video.youtube_id,
            currentProgress: player.currentTime,
          });
          if (response.error || response.status < 200 || response.status >= 300)
            throw new Error('Cast progress could not be saved.');
          if (!disposed) {
            setError('');
            if (response.data?.watched && !current.video.player.watched)
              current.onWatchStateChanged?.(true);
            if (paused) current.setRefresh?.();
          }
        } catch {
          if (!disposed) setError('Cast progress could not be saved. Pause again to retry.');
        } finally {
          saving = false;
        }
      };
      const connected = () => {
        if (disposed) return;
        void castStart.current?.connected(player.isConnected).catch(() => {
          if (!disposed) setError('Cast playback failed. Select Cast video to retry.');
        });
      };
      const time = () => {
        void progress();
      };
      const paused = () => {
        void progress(true);
      };
      const listeners: [string, () => void][] = [
        [framework.RemotePlayerEventType.IS_CONNECTED_CHANGED, connected],
        [framework.RemotePlayerEventType.CURRENT_TIME_CHANGED, time],
        [framework.RemotePlayerEventType.IS_PAUSED_CHANGED, paused],
      ];
      listeners.forEach(([type, listener]) => controller.addEventListener(type, listener));
      cleanup = () =>
        listeners.forEach(([type, listener]) => controller.removeEventListener(type, listener));
      setReady(true);
    };
    const available = (value: boolean) => {
      previous?.(value);
      setup(value);
    };
    host.__onGCastApiAvailable = available;
    setup(Boolean(host.cast));
    const existing = document.querySelector('script[src*="gstatic.com/cv/js/sender/"]');
    let script: HTMLScriptElement | undefined;
    const failed = () => {
      if (!disposed) setError('Google Cast could not load. Reload page to retry.');
    };
    if (!existing) {
      script = document.createElement('script');
      script.async = true;
      script.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
      script.addEventListener('error', failed);
      document.head.append(script);
    }
    return () => {
      disposed = true;
      mounted.current = false;
      castStart.current?.reset();
      castStart.current = null;
      cleanup();
      script?.removeEventListener('error', failed);
      if (host.__onGCastApiAvailable === available) host.__onGCastApiAvailable = previous;
    };
  }, []);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <Button variant="outline" disabled={!ready || pending} onClick={() => void start()}>
          {pending ? 'Connecting…' : 'Cast video'}
        </Button>
        {createElement('google-cast-launcher', {
          className: 'block size-8',
          'aria-label': 'Cast connection controls',
        })}
      </div>
      {error && (
        <p role="alert" className="text-sm text-foreground">
          {error}
        </p>
      )}
    </div>
  );
}
