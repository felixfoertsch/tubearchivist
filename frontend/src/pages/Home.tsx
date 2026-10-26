import type { ChannelType } from './Channels';
import type { SponsorBlockType } from './Video';

export type PlayerType = {
  watched: boolean;
  duration: number;
  duration_str: string;
  progress: number;
  position: number;
};

export type StatsType = {
  view_count: number;
  like_count: number;
  dislike_count: number;
  average_rating: number;
};

export type StreamType = {
  type: string;
  index: number;
  codec: string;
  width?: number;
  height?: number;
  bitrate: number;
};

export type Subtitles = {
  ext: string;
  url: string;
  name: string;
  lang: string;
  source: string;
  media_url: string;
};

export type VideoType = {
  active: boolean;
  category: string[];
  channel: ChannelType;
  date_downloaded: number;
  description: string;
  comment_count?: number | null;
  media_size: number;
  media_url: string;
  player: PlayerType;
  published: string;
  sponsorblock?: SponsorBlockType;
  playlist: string[];
  stats: StatsType;
  streams: StreamType[] | undefined;
  subtitles: Subtitles[];
  tags: string[];
  title: string;
  vid_last_refresh: string;
  vid_thumb_url: string;
  vid_type: string;
  youtube_id: string;
};

export type DownloadsType = {
  limit_speed: boolean;
  sleep_interval: number;
  autodelete_days: boolean;
  format: boolean;
  format_sort: boolean;
  add_metadata: boolean | 'simple';
  subtitle: boolean;
  subtitle_source: boolean;
  subtitle_index: boolean;
  comment_max: boolean;
  comment_sort: string;
  cookie_import: boolean;
  throttledratelimit: boolean;
  extractor_lang: boolean;
  integrate_ryd: boolean;
  integrate_sponsorblock: boolean;
};

export type ConfigType = {
  enable_cast: boolean;
  downloads: DownloadsType;
};
