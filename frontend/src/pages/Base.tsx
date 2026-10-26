type TaUpdateType = {
  version?: string;
  is_breaking?: boolean;
};

export type AuthenticationType = {
  response: string;
  user: number;
  version: string;
  ta_update: TaUpdateType;
};
