import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createBrowserRouter,
  RouterProvider,
  Outlet,
  NavLink,
  Link,
  redirect,
  type LoaderFunctionArgs,
} from 'react-router-dom';
import loadAuth from '../api/loader/loadAuth';
import loadUserConfig from '../api/loader/loadUserConfig';
import loadUserAccount from '../api/loader/loadUserAccount';
import loadAppsettingsConfig from '../api/loader/loadAppsettingsConfig';
import logOut from '../api/actions/logOut';
import { useAuthStore } from '../stores/AuthDataStore';
import { useUserConfigStore } from '../stores/UserConfigStore';
import { useUserAccountStore } from '../stores/UserAccountStore';
import { useAppSettingsStore } from '../stores/AppSettingsStore';
import useCanManageApp from '../functions/useCanManageApp';
import type { AuthenticationType } from '../pages/Base';
import NewRoutes from './routes';
import { loginHref } from './lib/navigation';
import { applyTheme, readTheme } from './lib/theme';
import { startTaskPolling } from './lib/tasks';
import { TaskIndicator } from './components/TaskNotifications';
import { Button } from './ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from './ui/sheet';
import Home from './Home';
import Video from './pages/Video';
import Channels from './pages/Channels';
import Channel from './pages/Channel';
import Playlists from './pages/Playlists';
import Playlist from './pages/Playlist';
import Search from './pages/Search';
import Download from './pages/Download';
import SettingsDashboard from './pages/SettingsDashboard';
import Login from './pages/Login';
import Settings from './pages/Settings';
import NotFound from './pages/NotFound';
import ErrorPage from './pages/ErrorPage';
import './style.css';

applyTheme(readTheme());

async function bootstrap({ request }: LoaderFunctionArgs) {
  const authResponse = await loadAuth();
  if (authResponse.status === 401 || authResponse.status === 403) {
    const url = new URL(request.url);
    return redirect(loginHref(url.pathname + url.search));
  }
  if (!authResponse.ok) throw new Error('Unable to check session.');
  const auth = (await authResponse.json()) as AuthenticationType;
  const [config, account, settings] = await Promise.all([
    loadUserConfig(),
    loadUserAccount(),
    loadAppsettingsConfig(),
  ]);
  for (const response of [config, account, settings]) {
    if (response.status === 403) throw new Response('Access denied', { status: 403 });
    if (response.status < 200 || response.status >= 300 || response.error || !response.data)
      throw new Error('Unable to load account preferences.');
  }
  useAuthStore.getState().setAuth(auth);
  useUserConfigStore.getState().setUserConfig(config.data!);
  useUserAccountStore.getState().setUserAccount(account.data!);
  useAppSettingsStore.getState().setAppSettingsConfig(settings.data!);
  return true;
}

function ThemeRoot() {
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const update = () => applyTheme(readTheme());
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return <Outlet />;
}

function App() {
  const canManageApp = useCanManageApp();
  const auth = useAuthStore(state => state.auth);
  const [error, setError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => (canManageApp ? startTaskPolling() : undefined), [canManageApp]);
  const links = [
    ['Home', NewRoutes.Home],
    ['Channels', NewRoutes.Channels],
    ['Playlists', NewRoutes.Playlists],
    ...(canManageApp ? [['Downloads', NewRoutes.Downloads]] : []),
    ['Search', NewRoutes.Search],
    ['Dashboard', NewRoutes.Dashboard],
    ['Settings', NewRoutes.Settings],
  ];
  const navigation = links.map(([label, href]) => (
    <NavLink
      key={href}
      to={href}
      end={href === NewRoutes.Home}
      onClick={() => setMenuOpen(false)}
      className={({ isActive }) =>
        `inline-flex items-center rounded-md px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring ${isActive ? 'bg-secondary text-secondary-foreground' : 'hover:bg-accent hover:text-accent-foreground'}`
      }
    >
      {label}
    </NavLink>
  ));
  async function logout() {
    setLoggingOut(true);
    setError('');
    try {
      const response = await logOut();
      if (response.status < 200 || response.status >= 300 || response.error)
        throw new Error('Logout failed.');
      window.location.assign(NewRoutes.Login);
    } catch {
      setError('Logout failed. Try again.');
      setLoggingOut(false);
    }
  }
  return (
    <>
      <a className="sr-only focus:not-sr-only focus:block focus:p-2" href="#main">
        Skip to content
      </a>
      <header className="border-b">
        <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-2 px-4 py-2">
          <Link to={NewRoutes.Home} className="mr-2 font-semibold tracking-tight">
            TubeArchivist
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-1 xl:flex">
            {navigation}
          </nav>
          <div className="xl:hidden">
            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm">
                  Menu
                </Button>
              </SheetTrigger>
              <SheetContent side="left">
                <SheetHeader>
                  <SheetTitle>TubeArchivist</SheetTitle>
                  <SheetDescription>Browse your archive.</SheetDescription>
                </SheetHeader>
                <nav aria-label="Mobile" className="flex flex-col items-stretch gap-1 p-4">
                  {navigation}
                </nav>
              </SheetContent>
            </Sheet>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-1">
            {canManageApp && <TaskIndicator />}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const next = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
                setTheme(next);
                applyTheme(next);
                try {
                  localStorage.setItem('ta-new-theme', next);
                } catch {
                  /* Storage may be disabled. */
                }
              }}
              aria-label={`Theme: ${theme}. Switch to ${theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system'}`}
            >
              {theme === 'system' ? 'System' : theme === 'dark' ? 'Dark' : 'Light'}
            </Button>
            <Button variant="ghost" size="sm" disabled={loggingOut} onClick={logout}>
              Logout
            </Button>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-screen-2xl space-y-4 p-4">
        {error && <p role="alert">{error}</p>}
        <Outlet />
      </main>
      <footer className="mx-auto flex max-w-screen-2xl flex-wrap gap-3 border-t p-4 text-sm">
        <span>TubeArchivist {auth?.version}</span>
        {auth?.ta_update?.version && (
          <span>
            {auth.ta_update.version} available
            {auth.ta_update.is_breaking ? ' — Breaking changes' : ''}
          </span>
        )}
      </footer>
    </>
  );
}

const router = createBrowserRouter([
  {
    element: <ThemeRoot />,
    errorElement: <ErrorPage />,
    hydrateFallbackElement: (
      <p role="status" className="p-6">
        Loading TubeArchivist…
      </p>
    ),
    children: [
      { path: NewRoutes.Login, element: <Login /> },
      {
        path: '/',
        loader: bootstrap,
        element: <App />,
        errorElement: <ErrorPage />,
        children: [
          { index: true, element: <Home /> },
          { path: 'video/:videoId', element: <Video /> },
          { path: 'channel', element: <Channels /> },
          { path: 'channel/:channelId', element: <Channel /> },
          { path: 'channel/:channelId/streams', element: <Channel /> },
          { path: 'channel/:channelId/shorts', element: <Channel /> },
          { path: 'channel/:channelId/playlist', element: <Channel /> },
          { path: 'channel/:channelId/about', element: <Channel /> },
          { path: 'playlist', element: <Playlists /> },
          { path: 'playlist/:playlistId', element: <Playlist /> },
          { path: 'search', element: <Search /> },
          { path: 'downloads', element: <Download /> },
          { path: 'dashboard', element: <SettingsDashboard /> },
          { path: 'settings', element: <Settings /> },
          { path: 'settings/user', loader: () => redirect('/settings/#user') },
          { path: 'settings/application', loader: () => redirect('/settings/#application') },
          { path: 'settings/scheduling', loader: () => redirect('/settings/#scheduling') },
          { path: 'settings/actions', loader: () => redirect('/settings/#actions') },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
