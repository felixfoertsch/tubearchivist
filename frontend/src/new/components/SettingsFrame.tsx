import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import useIsAdmin from '../../functions/useIsAdmin';
import { Card } from '../ui/card';
import NewRoutes from '../routes';
import TaskNotifications from './TaskNotifications';

export default function SettingsFrame({
  title,
  children,
  admin = true,
}: {
  title: string;
  children: ReactNode;
  admin?: boolean;
}) {
  const isAdmin = useIsAdmin();
  return (
    <section className="mx-auto w-full max-w-6xl space-y-4 p-3 sm:p-5">
      <title>{`TA | ${title}`}</title>
      <nav aria-label="Settings" className="flex flex-wrap gap-1 rounded-xl border bg-card/70 p-2">
        {[
          ['Dashboard', NewRoutes.SettingsDashboard],
          ['User', NewRoutes.SettingsUser],
          ...(isAdmin
            ? [
                ['Application', NewRoutes.SettingsApplication],
                ['Scheduling', NewRoutes.SettingsScheduling],
                ['Actions', NewRoutes.SettingsActions],
              ]
            : []),
        ].map(([label, path]) => (
          <NavLink
            end
            key={path}
            to={path}
            className={({ isActive }) =>
              `rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-secondary text-secondary-foreground' : 'hover:bg-secondary/60'}`
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {isAdmin && <TaskNotifications pageName="all" includeReindex />}
      {admin && !isAdmin ? (
        <Card className="p-4">
          <p role="alert">Administrator access required.</p>
        </Card>
      ) : (
        children
      )}
    </section>
  );
}
