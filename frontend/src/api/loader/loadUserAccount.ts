import APIClient from '../../functions/APIClient';

export type UserAccountType = {
  id: number;
  name: string;
  is_superuser: boolean;
  is_staff: boolean;
  groups: [];
  user_permissions: [];
  last_login: string;
  can_manage_app: boolean;
  can_administer: boolean;
};

const loadUserAccount = async () => {
  return APIClient<UserAccountType>('/api/user/account/');
};

export default loadUserAccount;
