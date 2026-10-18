import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider, useLoaderData } from 'react-router-dom';
import loadAuth from '../api/loader/loadAuth';
import loadUserConfig from '../api/loader/loadUserConfig';
import loadUserAccount from '../api/loader/loadUserAccount';
import loadAppsettingsConfig from '../api/loader/loadAppsettingsConfig';
import logOut from '../api/actions/logOut';
import { useAuthStore } from '../stores/AuthDataStore';
import { useUserConfigStore } from '../stores/UserConfigStore';
import { useUserAccountStore } from '../stores/UserAccountStore';
import { useAppSettingsStore } from '../stores/AppSettingsStore';
import useIsAdmin from '../functions/useIsAdmin';
import Routes from '../configuration/routes/RouteList';
import type { AuthenticationType } from '../pages/Base';
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
import './style.css';

async function bootstrap() {
  const authResponse = await loadAuth();
  if (authResponse.status === 401 || authResponse.status === 403) {
    window.location.replace('/login/?next=%2Fnew%2F');
    return null;
  }
  if (!authResponse.ok) throw new Error('Unable to check session. Reload to retry.');
  const auth = (await authResponse.json()) as AuthenticationType;
  const [config, account, settings] = await Promise.all([
    loadUserConfig(),
    loadUserAccount(),
    loadAppsettingsConfig(),
  ]);
  for (const response of [config, account, settings]) {
    if (response.status < 200 || response.status >= 300 || response.error || !response.data)
      throw new Error('Unable to load account preferences. Reload to retry.');
  }
  useAuthStore.getState().setAuth(auth);
  useUserConfigStore.getState().setUserConfig(config.data!);
  useUserAccountStore.getState().setUserAccount(account.data!);
  useAppSettingsStore.getState().setAppSettingsConfig(settings.data!);
  return true;
}

function App() {
  const ready = useLoaderData();
  const isAdmin = useIsAdmin();
  const [error, setError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('ta-new-theme') || 'system';
    } catch {
      return 'system';
    }
  });
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () =>
      document.documentElement.classList.toggle(
        'dark',
        theme === 'dark' || (theme === 'system' && media.matches),
      );
    apply();
    media.addEventListener('change', apply);
    try {
      localStorage.setItem('ta-new-theme', theme);
    } catch {
      /* Storage can be disabled. */
    }
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  if (!ready) return <p role="status">Redirecting to login…</p>;
  const links = [
    ['Home', '/new/'],
    ['Channels', Routes.Channels],
    ['Playlists', Routes.Playlists],
    ...(isAdmin ? [['Downloads', Routes.Downloads]] : []),
    ['Search', Routes.Search],
    ['Settings', Routes.SettingsDashboard],
  ];
  const navigation = (
    <>
      {links.map(([label, href]) => (
        <Button key={label} variant={label === 'Home' ? 'secondary' : 'ghost'} size="sm" asChild>
          <a href={href} aria-current={label === 'Home' ? 'page' : undefined}>
            {label}
          </a>
        </Button>
      ))}
    </>
  );
  const logout = async () => {
    setLoggingOut(true);
    setError('');
    try {
      const response = await logOut();
      if (response.status < 200 || response.status >= 300 || response.error)
        throw new Error('Logout failed. Try again.');
      window.location.assign('/login/?next=%2Fnew%2F');
    } catch {
      setError('Logout failed. Try again.');
      setLoggingOut(false);
    }
  };
  return (
    <>
      <a className="sr-only focus:not-sr-only focus:block focus:p-2" href="#main">
        Skip to content
      </a>
      <header className="border-b">
        <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-2 px-4 py-2">
          <a href="/new/" className="mr-2 font-semibold tracking-tight">
            TubeArchivist
          </a>
          <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
            {navigation}
          </nav>
          <div className="lg:hidden">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm">
                  Menu
                </Button>
              </SheetTrigger>
              <SheetContent side="left">
                <SheetHeader>
                  <SheetTitle>TubeArchivist</SheetTitle>
                  <SheetDescription>
                    Browse archive. Other pages open in Classic UI.
                  </SheetDescription>
                </SheetHeader>
                <nav aria-label="Mobile" className="flex flex-col items-stretch gap-1 p-4">
                  {navigation}
                </nav>
              </SheetContent>
            </Sheet>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setTheme(theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system')
              }
              aria-label={`Theme: ${theme}. Switch to ${theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system'}`}
            >
              {theme === 'system' ? 'System' : theme === 'dark' ? 'Dark' : 'Light'}
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href="/">Classic UI</a>
            </Button>
            <Button variant="ghost" size="sm" disabled={loggingOut} onClick={logout}>
              Logout
            </Button>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-screen-2xl space-y-4 p-4">
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <Home />
        <p className="border-t pt-4 text-xs text-muted-foreground">
          Menu and Home preview. Playback and other pages open in Classic UI.
        </p>
      </main>
    </>
  );
}

function LoadError() {
  return (
    <main className="mx-auto max-w-xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">Unable to load TubeArchivist</h1>
      <p role="alert">Session or account settings could not be loaded.</p>
      <Button variant="outline" onClick={() => window.location.reload()}>
        Retry
      </Button>{' '}
      <Button variant="outline" asChild>
        <a href="/">Classic UI</a>
      </Button>
    </main>
  );
}
const router = createBrowserRouter([
  {
    path: '/new/',
    loader: bootstrap,
    element: <App />,
    errorElement: <LoadError />,
    hydrateFallbackElement: (
      <p role="status" className="p-6">
        Loading TubeArchivist…
      </p>
    ),
  },
]);
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
