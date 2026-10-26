import { useUserAccountStore } from '../stores/UserAccountStore';

const useCanManageApp = () => {
  const { userAccount } = useUserAccountStore();
  return userAccount?.can_manage_app;
};

export default useCanManageApp;
