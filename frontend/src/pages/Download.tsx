import type { ConfigType } from './Home';
import type { PaginationType } from '../components/Pagination';

type Download = {
  auto_start: boolean;
  channel_id: string;
  channel_indexed: boolean;
  channel_name: string;
  duration: string;
  message?: string;
  published: string | null;
  status: string;
  timestamp: number | null;
  title: string;
  vid_thumb_url: string | null;
  vid_type: string;
  youtube_id: string;
  _index: string;
  _score: number;
};

export type DownloadResponseType = {
  data?: Download[];
  config?: ConfigType;
  paginate?: PaginationType;
};
