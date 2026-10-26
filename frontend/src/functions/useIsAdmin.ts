import { useUserAccountStore } from '../stores/UserAccountStore';

const useIsAdmin = () => {
  const { userAccount } = useUserAccountStore();
  return userAccount?.can_administer;
};

export default useIsAdmin;
