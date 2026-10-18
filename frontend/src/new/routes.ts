const segment = (id: string) => encodeURIComponent(id);

const NewRoutes = {
  Home: '/new/',
  Channels: '/new/channel/',
  Channel: (id: string) => `/new/channel/${segment(id)}`,
  ChannelVideo: (id: string) => `/new/channel/${segment(id)}`,
  ChannelStream: (id: string) => `/new/channel/${segment(id)}/streams/`,
  ChannelShorts: (id: string) => `/new/channel/${segment(id)}/shorts/`,
  ChannelPlaylist: (id: string) => `/new/channel/${segment(id)}/playlist/`,
  ChannelAbout: (id: string) => `/new/channel/${segment(id)}/about/`,
  Playlists: '/new/playlist/',
  Playlist: (id: string) => `/new/playlist/${segment(id)}`,
  Downloads: '/new/downloads/',
  DownloadsByChannelId: (id: string) => `/new/downloads/?channel=${segment(id)}&ignored=false`,
  IgnoredByChannelId: (id: string) => `/new/downloads/?channel=${segment(id)}&ignored=true`,
  Search: '/new/search/',
  Dashboard: '/new/dashboard/',
  Settings: '/new/settings/',
  SettingsUser: '/new/settings/#user',
  SettingsApplication: '/new/settings/#application',
  SettingsScheduling: '/new/settings/#scheduling',
  SettingsActions: '/new/settings/#actions',
  Login: '/new/login/',
  Video: (id: string) => `/new/video/${segment(id)}`,
  VideoAtTimestamp: (id: string, timestamp: string) =>
    `/new/video/${segment(id)}/?t=${segment(timestamp)}`,
};

export default NewRoutes;
