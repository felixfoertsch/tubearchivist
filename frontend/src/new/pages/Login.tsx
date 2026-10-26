import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import signIn from '../../api/actions/signIn';
import loadAuth from '../../api/loader/loadAuth';
import loadAuthOptions, { type AuthOptionsType } from '../../api/loader/loadAuthOptions';
import { safeReturnTo } from '../lib/navigation';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Checkbox } from '../ui/checkbox';

export default function Login() {
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get('next'));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState(
    params.has('oidc_error') ? 'Authentik sign-in failed. Try again or use local recovery.' : '',
  );
  const [retry, setRetry] = useState(0);
  const [authOptions, setAuthOptions] = useState<AuthOptionsType | null>(null);
  useEffect(() => {
    let active = true;
    loadAuthOptions()
      .then(response => {
        if (!active) return;
        if (response.data && !response.error && response.status === 200)
          setAuthOptions(response.data);
        else setError('Sign-in options unavailable. Local recovery remains available.');
      })
      .catch(() => {
        if (active) {
          setAuthOptions(null);
          setError('Sign-in options unavailable. Local recovery remains available.');
        }
      });
    loadAuth()
      .then(response => {
        if (!active) return;
        if (response.ok) window.location.replace(returnTo);
        else if (response.status !== 401 && response.status !== 403)
          setError('Backend unavailable. Check your server configuration and retry.');
      })
      .catch(() => {
        if (active) setError('Backend unavailable. Check your server configuration and retry.');
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [returnTo, retry]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await signIn(username, password, remember);
      if (response.status === 204) {
        window.location.assign(returnTo);
        return;
      }
      setError(
        response.status === 400 || response.status === 401 || response.status === 403
          ? 'Login failed. Check your username and password, then try again.'
          : 'Login unavailable. Try again.',
      );
    } catch {
      setError('Unable to reach backend. Try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto max-w-md space-y-4 p-6">
      <title>TA | Welcome</title>
      <Card>
        <CardHeader>
          <CardTitle>TubeArchivist</CardTitle>
          <CardDescription>Your Self Hosted YouTube Media Server</CardDescription>
        </CardHeader>
        <CardContent>
          {authOptions?.oidc_enabled && authOptions.oidc_login_url === '/api/user/oidc/login/' && (
            <a
              className="mb-4 inline-flex rounded-md border px-4 py-2 underline focus-visible:outline-none focus-visible:ring-2"
              href={`${authOptions.oidc_login_url}?next=${encodeURIComponent(returnTo)}`}
            >
              Sign in with Authentik
            </a>
          )}
          {authOptions?.oidc_enabled && <h2 className="mb-3 font-semibold">Local recovery</h2>}
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                name="username"
                autoComplete="username"
                maxLength={150}
                required
                value={username}
                onChange={event => setUsername(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={event => setPassword(event.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="remember"
                checked={remember}
                onCheckedChange={value => setRemember(value === true)}
              />
              <Label htmlFor="remember">Remember me</Label>
            </div>
            {error && (
              <div role="alert" className="space-y-2">
                <p>{error}</p>
                {!error.startsWith('Login failed') && (
                  <>
                    <Button
                      type="button"
                      variant="default"
                      onClick={() => {
                        setError('');
                        setChecking(true);
                        setRetry(value => value + 1);
                      }}
                    >
                      Retry connection
                    </Button>
                    <p className="text-sm text-muted-foreground">
                      Verify TA_HOST matches {window.location.origin} and PostgreSQL is reachable.
                      See installation guide.
                    </p>
                  </>
                )}
              </div>
            )}
            {checking && <p role="status">Checking session…</p>}
            <Button variant="default" type="submit" disabled={busy || checking}>
              {busy ? 'Signing in…' : 'Login'}
            </Button>
          </form>
        </CardContent>
      </Card>
      <nav aria-label="Login links" className="flex flex-wrap gap-4 text-sm underline">
        <a href="https://github.com/tubearchivist/tubearchivist" target="_blank" rel="noreferrer">
          GitHub
        </a>
        <a
          href="https://github.com/tubearchivist/tubearchivist#donate"
          target="_blank"
          rel="noreferrer"
        >
          Donate
        </a>
        <a href="https://docs.tubearchivist.com/installation/" target="_blank" rel="noreferrer">
          Installation guide
        </a>
      </nav>
    </main>
  );
}
