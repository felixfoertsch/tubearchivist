type ChannelOverwritesType = {
  auto_ignore_filter?: string | null;
  rolling_window_size?: number | null;
  download_format: string | null;
  autodelete_days: number | null;
  index_playlists: boolean | null;
  integrate_sponsorblock: boolean | null;
  subscriptions_channel_size: number | null;
  subscriptions_live_channel_size: number | null;
  subscriptions_shorts_channel_size: number | null;
};

export type ChannelType = {
  channel_active: boolean;
  channel_banner_url: string;
  channel_description: string;
  channel_id: string;
  channel_last_refresh: string;
  channel_name: string;
  channel_overwrites?: ChannelOverwritesType;
  channel_subs: number;
  channel_subscribed: boolean;
  channel_tags?: string[];
  channel_thumb_url: string;
  channel_tvart_url: string;
};
