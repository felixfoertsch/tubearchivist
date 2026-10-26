import APIClient from '../../functions/APIClient';

export type AuthOptionsType = {
  oidc_enabled: boolean;
  oidc_login_url: '/api/user/oidc/login/' | null;
  local_login_enabled: true;
};

const loadAuthOptions = async () => APIClient<AuthOptionsType>('/api/user/auth-options/');

export default loadAuthOptions;
