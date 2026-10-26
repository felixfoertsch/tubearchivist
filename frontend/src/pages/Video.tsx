export type SponsorBlockSegmentType = {
  category: string;
  actionType: string;
  segment: number[];
  UUID: string;
  videoDuration: number;
  locked: number;
  votes: number;
};

export type SponsorBlockType = {
  last_refresh: number;
  has_unlocked: boolean;
  is_enabled: boolean;
  segments: SponsorBlockSegmentType[];
  message?: string;
};
