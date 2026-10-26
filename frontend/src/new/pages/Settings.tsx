import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import useCanManageApp from '../../functions/useCanManageApp';
import SettingsFrame from '../components/SettingsFrame';
import SettingsUser from './SettingsUser';
import SettingsApplication from './SettingsApplication';
import SettingsScheduling from './SettingsScheduling';
import SettingsActions from './SettingsActions';

export default function Settings() {
  const canManageApp = useCanManageApp();
  const { hash } = useLocation();
  useEffect(() => {
    const target = ['#user', '#application', '#scheduling', '#actions'].includes(hash)
      ? document.getElementById(hash.slice(1))
      : null;
    target?.scrollIntoView();
  }, [hash]);
  return (
    <SettingsFrame title="Settings" admin={false}>
      <section id="user" aria-labelledby="user-heading" className="space-y-4 scroll-mt-4">
        <h2 id="user-heading" className="text-xl font-semibold">
          User
        </h2>
        <SettingsUser />
      </section>
      {canManageApp && (
        <section
          id="application"
          aria-labelledby="application-heading"
          className="space-y-4 scroll-mt-4"
        >
          <h2 id="application-heading" className="text-xl font-semibold">
            Application
          </h2>
          <SettingsApplication />
        </section>
      )}
      {canManageApp && (
        <>
          <section
            id="scheduling"
            aria-labelledby="scheduling-heading"
            className="space-y-4 scroll-mt-4"
          >
            <h2 id="scheduling-heading" className="text-xl font-semibold">
              Scheduling
            </h2>
            <SettingsScheduling />
          </section>
          <section id="actions" aria-labelledby="actions-heading" className="space-y-4 scroll-mt-4">
            <h2 id="actions-heading" className="text-xl font-semibold">
              Actions
            </h2>
            <SettingsActions />
          </section>
        </>
      )}
    </SettingsFrame>
  );
}
