const segment = (id: string) => encodeURIComponent(id);

const NewRoutes = {
  Home: '/',
  Channels: '/channel/',
  Channel: (id: string) => `/channel/${segment(id)}`,
  ChannelVideo: (id: string) => `/channel/${segment(id)}`,
  ChannelStream: (id: string) => `/channel/${segment(id)}/streams/`,
  ChannelShorts: (id: string) => `/channel/${segment(id)}/shorts/`,
  ChannelPlaylist: (id: string) => `/channel/${segment(id)}/playlist/`,
  ChannelAbout: (id: string) => `/channel/${segment(id)}/about/`,
  Playlists: '/playlist/',
  Playlist: (id: string) => `/playlist/${segment(id)}`,
  Downloads: '/downloads/',
  DownloadsByChannelId: (id: string) => `/downloads/?channel=${segment(id)}&ignored=false`,
  IgnoredByChannelId: (id: string) => `/downloads/?channel=${segment(id)}&ignored=true`,
  Search: '/search/',
  Dashboard: '/dashboard/',
  Settings: '/settings/',
  SettingsUser: '/settings/#user',
  SettingsApplication: '/settings/#application',
  SettingsScheduling: '/settings/#scheduling',
  SettingsActions: '/settings/#actions',
  Login: '/login/',
  Video: (id: string) => `/video/${segment(id)}`,
  VideoAtTimestamp: (id: string, timestamp: string) =>
    `/video/${segment(id)}/?t=${segment(timestamp)}`,
};

export default NewRoutes;
