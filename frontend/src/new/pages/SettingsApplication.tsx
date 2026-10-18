import { useConfirm } from '../components/useConfirm';
import { useEffect, useState } from 'react';
import useIsAdmin from '../../functions/useIsAdmin';
import type { AppSettingsConfigType } from '../../api/loader/loadAppsettingsConfig';
import type { SnapshotListType } from '../../api/loader/loadSnapshots';
import type { CookieStateType } from '../../api/loader/loadCookie';
import { SettingsApplicationSection } from '../components/SettingsApplicationSections';
import {
  isoDateTime,
  loadApplicationSettings,
  saveApplicationSetting,
} from '../lib/settingsApplication';
import { requestJson, settingsError } from '../lib/settings';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { NativeSelect } from '../ui/native-select';
import { Textarea } from '../ui/textarea';
import { Checkbox } from '../ui/checkbox';

type State = {
  settings: AppSettingsConfigType;
  snapshots: SnapshotListType;
  token: string;
  cookie: CookieStateType;
};
const fields = [
  [
    'subscriptions',
    'channel_size',
    'Videos page size',
    'number',
    0,
    'Maximum channel videos checked per subscription scan.',
  ],
  [
    'subscriptions',
    'live_channel_size',
    'Live streams page size',
    'number',
    0,
    'Set to 0 to disable stream scanning.',
  ],
  [
    'subscriptions',
    'shorts_channel_size',
    'Shorts page size',
    'number',
    0,
    'Set to 0 to disable Shorts scanning.',
  ],
  [
    'subscriptions',
    'playlist_size',
    'Playlist page size',
    'number',
    0,
    'Maximum items scanned in each playlist.',
  ],
  [
    'downloads',
    'limit_speed',
    'Download speed limit (B/s)',
    'number',
    0,
    'Zero or empty disables speed limit.',
  ],
  [
    'downloads',
    'throttledratelimit',
    'Throttled rate limit (B/s)',
    'number',
    0,
    'Restart download when speed drops below limit.',
  ],
  [
    'downloads',
    'sleep_interval',
    'Sleep interval (s)',
    'number',
    0,
    'Randomized by ±50%; 10 seconds minimum recommended.',
  ],
  [
    'downloads',
    'autodelete_days',
    'Auto-delete watched after days',
    'number',
    0,
    'Destructive: deletes watched video files after download; also configurable per channel.',
  ],
  [
    'downloads',
    'format',
    'Download format',
    'text',
    undefined,
    'yt-dlp -f format selector. See yt-dlp format selection documentation.',
  ],
  ['downloads', 'format_sort', 'Format sort', 'text', undefined, 'yt-dlp --format-sort criteria.'],
  [
    'downloads',
    'extractor_lang',
    'Extractor language',
    'text',
    undefined,
    'Two-letter ISO language code; effective when uploader provides translations.',
  ],
  [
    'downloads',
    'subtitle',
    'Subtitle languages',
    'text',
    undefined,
    'Comma-separated language codes, for example en, de, zh-Hans.',
  ],
  [
    'downloads',
    'comment_max',
    'Comment indexing limit',
    'text',
    undefined,
    'max-comments,max-parents,max-replies,max-replies-per-thread,max-depth. Extraction can be slow.',
  ],
  [
    'downloads',
    'pot_provider_url',
    'PO Token Provider URL',
    'text',
    undefined,
    'URL of externally hosted PO Token Provider. Review trusted provider before saving.',
  ],
] as const;
function AdminSettings() {
  const { confirm, dialog } = useConfirm();
  const [data, setData] = useState<State>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState('');
  const [cookieDraft, setCookieDraft] = useState('');
  const [cookieEntry, setCookieEntry] = useState(false);
  const [cookieReveal, setCookieReveal] = useState(false);
  const [tokenVisible, setTokenVisible] = useState(false);
  const [visibleSnapshots, setVisibleSnapshots] = useState(10);
  async function refresh() {
    try {
      const result = await loadApplicationSettings();
      setData(result);
      setError('');
    } catch (caught) {
      setError(settingsError(caught));
    }
  }
  useEffect(() => {
    let active = true;
    loadApplicationSettings()
      .then(result => {
        if (active) {
          setData(result);
          setError('');
        }
      })
      .catch(caught => {
        if (active) setError(settingsError(caught));
      });
    return () => {
      active = false;
    };
  }, []);
  async function mutate(name: string, action: () => Promise<void>, destructive = false) {
    if (pending) return false;
    setPending(name);
    setError('');
    try {
      if (
        destructive &&
        !(await confirm({
          title: `Confirm ${name}?`,
          description: `Proceed with ${name}. This operation changes stored data.`,
        }))
      )
        return false;
      await action();
      await refresh();
      return true;
    } catch (caught) {
      setError(settingsError(caught));
      return false;
    } finally {
      setPending('');
    }
  }
  async function setConfig(
    group: 'subscriptions' | 'downloads' | 'application',
    key: string,
    value: string | boolean | number | null,
  ) {
    await saveApplicationSetting(group, key, value);
  }
  return (
    <>
      {dialog}
      <p className="text-sm text-muted-foreground">
        Server-wide settings. Secret values stay masked unless revealed.
      </p>
      {error && (
        <p role="alert" className="text-sm text-foreground">
          {error}
        </p>
      )}
      {!data ? (
        error ? (
          <Button variant="outline" disabled={!!pending} onClick={() => void refresh()}>
            Retry loading application settings
          </Button>
        ) : (
          <p role="status">Loading application settings…</p>
        )
      ) : (
        <>
          <SettingsApplicationSection title="Subscription scan">
            {fields
              .filter(([group]) => group === 'subscriptions')
              .map(([group, key, label, type, min, help]) => (
                <SettingField
                  key={`${group}.${key}`}
                  group={group}
                  name={key}
                  label={label}
                  help={help}
                  type={type}
                  min={min}
                  value={
                    data.settings.subscriptions[key as keyof typeof data.settings.subscriptions] as
                      | number
                      | null
                  }
                  busy={!!pending}
                  onSave={value => mutate(label, () => setConfig(group, key, value))}
                />
              ))}
            {(['auto_start', 'extract_flat'] as const).map(key => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={data.settings.subscriptions[key]}
                  disabled={!!pending}
                  onCheckedChange={checked =>
                    void mutate(key, () => setConfig('subscriptions', key, checked === true))
                  }
                />
                {key === 'auto_start' ? 'Autostart downloads' : 'Fast add'}
              </label>
            ))}
          </SettingsApplicationSection>
          <SettingsApplicationSection title="Downloads">
            {fields
              .filter(([group]) => group === 'downloads')
              .map(([group, key, label, type, min, help]) => (
                <SettingField
                  key={`${group}.${key}`}
                  group={group}
                  name={key}
                  label={label}
                  help={help}
                  type={type}
                  min={min}
                  value={
                    data.settings.downloads[key as keyof typeof data.settings.downloads] as
                      | string
                      | number
                      | null
                  }
                  busy={!!pending}
                  destructive={key === 'autodelete_days'}
                  onSave={value =>
                    mutate(label, () => setConfig(group, key, value), key === 'autodelete_days')
                  }
                />
              ))}
            <label className="grid gap-1 text-sm">
              Embed metadata
              <NativeSelect
                value={String(data.settings.downloads.add_metadata)}
                disabled={!!pending}
                onChange={event =>
                  void mutate('Embed metadata', () =>
                    setConfig(
                      'downloads',
                      'add_metadata',
                      event.target.value === 'simple' ? 'simple' : event.target.value === 'true',
                    ),
                  )
                }
              >
                <option value="false">Off</option>
                <option value="true">Full</option>
                <option value="simple">Simple (download only)</option>
              </NativeSelect>
              <span className="text-xs text-muted-foreground">
                Simple embeds title, artist, description and thumbnail at download time only.
                Refresh leaves existing files untouched. Full also embeds archive data and updates
                files during refresh.
              </span>
            </label>
            {(['subtitle_index', 'integrate_ryd', 'integrate_sponsorblock'] as const).map(key => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={data.settings.downloads[key]}
                  disabled={!!pending}
                  onCheckedChange={checked =>
                    void mutate(key, () => setConfig('downloads', key, checked === true))
                  }
                />
                {key === 'subtitle_index'
                  ? 'Index subtitles'
                  : key === 'integrate_ryd'
                    ? 'Return YouTube Dislike'
                    : 'SponsorBlock'}
              </label>
            ))}
            <label className="grid gap-1 text-sm">
              Subtitle source
              <NativeSelect
                value={data.settings.downloads.subtitle_source || 'user'}
                disabled={!!pending}
                onChange={event =>
                  void mutate('Subtitle source', () =>
                    setConfig('downloads', 'subtitle_source', event.target.value),
                  )
                }
              >
                <option value="user">Uploaded</option>
                <option value="auto">Auto-generated fallback</option>
              </NativeSelect>
            </label>
            <label className="grid gap-1 text-sm">
              Comment sort
              <NativeSelect
                value={data.settings.downloads.comment_sort ?? ''}
                disabled={!!pending}
                onChange={event =>
                  void mutate('Comment sort', () =>
                    setConfig('downloads', 'comment_sort', event.target.value),
                  )
                }
              >
                <option value="" disabled>
                  Unset
                </option>
                <option value="top">Top</option>
                <option value="new">New</option>
              </NativeSelect>
            </label>
          </SettingsApplicationSection>
          <SettingsApplicationSection title="Cookie and integrations">
            <p className="text-sm">
              Cookie:{' '}
              {data.cookie.cookie_enabled
                ? `Enabled; last validation ${data.cookie.validated ? isoDateTime(data.cookie.validated) : 'Unknown'}`
                : 'Disabled'}
            </p>
            {cookieEntry ? (
              <label className="grid gap-1 text-sm">
                Netscape cookie file
                {cookieReveal ? (
                  <Textarea
                    aria-label="Netscape cookie file"
                    className="min-h-36 font-mono text-xs"
                    autoComplete="off"
                    value={cookieDraft}
                    onChange={event => setCookieDraft(event.target.value)}
                  />
                ) : (
                  <Input
                    aria-label="Masked Netscape cookie entry"
                    type="password"
                    readOnly
                    value={cookieDraft}
                    placeholder="Reveal entry to paste multiline Netscape cookies"
                  />
                )}
              </label>
            ) : (
              <p className="text-sm text-muted-foreground">
                Cookie contents never display after entry.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {!cookieEntry && (
                <Button variant="outline" onClick={() => setCookieEntry(true)}>
                  Enter cookie
                </Button>
              )}
              {cookieEntry && (
                <>
                  <Button variant="outline" onClick={() => setCookieReveal(!cookieReveal)}>
                    {cookieReveal ? 'Mask cookie entry' : 'Reveal cookie entry'}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={!!pending || !cookieDraft}
                    onClick={() =>
                      void mutate('Cookie update', async () => {
                        await requestJson('/api/appsettings/cookie/', {
                          method: 'PUT',
                          body: JSON.stringify({ cookie: cookieDraft }),
                        });
                        setCookieDraft('');
                        setCookieEntry(false);
                        setCookieReveal(false);
                      })
                    }
                  >
                    Save cookie
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setCookieDraft('');
                      setCookieEntry(false);
                      setCookieReveal(false);
                    }}
                  >
                    Cancel
                  </Button>
                </>
              )}
              {data.cookie.cookie_enabled && (
                <>
                  <Button
                    variant="outline"
                    disabled={!!pending}
                    onClick={() =>
                      void mutate('Cookie validation', () =>
                        requestJson('/api/appsettings/cookie/', { method: 'POST' }).then(
                          () => undefined,
                        ),
                      )
                    }
                  >
                    Validate
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!!pending}
                    onClick={() =>
                      void mutate(
                        'cookie revoke',
                        () =>
                          requestJson('/api/appsettings/cookie/', { method: 'DELETE' }).then(
                            () => undefined,
                          ),
                        true,
                      )
                    }
                  >
                    Revoke cookie
                  </Button>
                </>
              )}
            </div>
            {cookieEntry && (
              <p className="text-xs text-muted-foreground">
                Cookie text is obscured while editing. Revealing changes display only. Netscape rows
                require line breaks.
              </p>
            )}
            <p className="text-sm">API token</p>
            <div className="flex gap-2">
              <Input
                type={tokenVisible ? 'text' : 'password'}
                readOnly
                value={data.token}
                aria-label="API token"
              />
              <Button variant="outline" onClick={() => setTokenVisible(!tokenVisible)}>
                {tokenVisible ? 'Hide' : 'Reveal'}
              </Button>
              <Button
                variant="outline"
                disabled={!!pending}
                onClick={() =>
                  void mutate(
                    'API token revoke',
                    () =>
                      requestJson('/api/appsettings/token/', { method: 'DELETE' }).then(
                        () => undefined,
                      ),
                    true,
                  )
                }
              >
                Revoke
              </Button>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={data.settings.application.enable_cast}
                disabled={!!pending}
                onCheckedChange={checked =>
                  void mutate('Cast', () =>
                    setConfig('application', 'enable_cast', checked === true),
                  )
                }
              />
              Enable Cast
            </label>
            <Membership />
          </SettingsApplicationSection>
          <SettingsApplicationSection title="Snapshots">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={data.settings.application.enable_snapshot}
                disabled={!!pending}
                onCheckedChange={checked =>
                  void mutate('Snapshots', () =>
                    setConfig('application', 'enable_snapshot', checked === true),
                  )
                }
              />
              Enable index snapshots
            </label>
            <p className="text-sm">
              Next snapshot: {isoDateTime(data.snapshots.next_exec)}; expires after{' '}
              {data.snapshots.expire_after}.
            </p>
            <Button
              variant="secondary"
              disabled={!!pending || !data.settings.application.enable_snapshot}
              onClick={() =>
                void mutate('create snapshot', () =>
                  requestJson('/api/appsettings/snapshot/', { method: 'POST' }).then(
                    () => undefined,
                  ),
                )
              }
            >
              Create snapshot now
            </Button>
            {(data.snapshots.snapshots || []).slice(0, visibleSnapshots).map(snapshot => (
              <div key={snapshot.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span>
                  {isoDateTime(snapshot.end_stamp - snapshot.duration_s)}, {snapshot.duration_s}s,{' '}
                  {snapshot.state}
                </span>
                <Button
                  variant="outline"
                  disabled={!!pending || snapshot.state !== 'SUCCESS'}
                  onClick={() =>
                    snapshot.state === 'SUCCESS' &&
                    void mutate(
                      'restore snapshot',
                      () =>
                        requestJson(
                          `/api/appsettings/snapshot/${encodeURIComponent(snapshot.id)}/`,
                          { method: 'POST' },
                        ).then(() => undefined),
                      true,
                    )
                  }
                >
                  Restore
                </Button>
              </div>
            ))}
            {(data.snapshots.snapshots?.length || 0) > visibleSnapshots && (
              <Button variant="outline" onClick={() => setVisibleSnapshots(count => count + 10)}>
                Load more
              </Button>
            )}
          </SettingsApplicationSection>
        </>
      )}
    </>
  );
}
function SettingsApplication() {
  const isAdmin = useIsAdmin();
  return isAdmin ? <AdminSettings /> : <>Administrator access required.</>;
}
function SettingField({
  group,
  name,
  label,
  help,
  type,
  min,
  value,
  busy,
  destructive,
  onSave,
}: {
  group: 'subscriptions' | 'downloads';
  name: string;
  label: string;
  help: string;
  type: 'number' | 'text';
  min?: number;
  value: string | number | null;
  busy: boolean;
  destructive?: boolean;
  onSave: (value: string | number | null) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(String(value ?? ''));
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const current = String(value ?? '');
  const dirty = draft !== current;
  const id = `${group}-${name}`;
  async function submit() {
    let next: string | number | null = draft;
    if (type === 'number' && draft !== '') {
      const number = Number(draft);
      if (!Number.isSafeInteger(number) || number < (min ?? 0)) {
        setError(`Enter a whole number of at least ${min ?? 0}.`);
        return;
      }
      next = number;
    } else if (!draft) next = null;
    setError('');
    setSaved(false);
    const success = await onSave(next);
    setSaved(success);
    if (!success) setError('Setting was not saved. Check request error above, then retry.');
  }
  return (
    <div className="grid content-start gap-1 text-sm">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <Input
        id={id}
        type={type}
        min={type === 'number' ? min : undefined}
        step={type === 'number' ? 1 : undefined}
        value={draft}
        disabled={busy}
        onChange={event => {
          setDraft(event.target.value);
          setSaved(false);
        }}
      />
      <p className="text-xs text-muted-foreground">
        {help}
        {name === 'format' && (
          <>
            {' '}
            <a
              target="_blank"
              rel="noopener noreferrer"
              href="https://github.com/yt-dlp/yt-dlp?tab=readme-ov-file#format-selection"
              className="underline"
            >
              yt-dlp format selection
            </a>
            .
          </>
        )}
      </p>
      {destructive && (
        <p className="text-xs text-foreground">
          Saving this setting can permanently delete watched files.
        </p>
      )}
      {(dirty || saved) && (
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || !dirty}
            onClick={() => void submit()}
          >
            Save
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setDraft(current);
              setError('');
              setSaved(false);
            }}
          >
            Cancel
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-foreground">
          {error}
        </p>
      )}
      {saved && !dirty && (
        <p role="status" className="text-xs">
          Saved.
        </p>
      )}
    </div>
  );
}
function Membership() {
  const { confirm, dialog } = useConfirm();
  const [token, setToken] = useState('');
  const [storedToken, setStoredToken] = useState('');
  const [visible, setVisible] = useState(false);
  const [stored, setStored] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [profile, setProfile] = useState<{
    user: { username: string };
    sponsor_tier: { name: string; description: string; max_subs: number };
    subscription_count: number;
    is_connected: boolean;
  }>();
  useEffect(() => {
    const controller = new AbortController();
    requestJson<unknown>('/api/appsettings/membership/token/', { signal: controller.signal })
      .then(value => {
        if (
          !value ||
          typeof value !== 'object' ||
          !('token' in value) ||
          !(typeof value.token === 'string' || value.token === null)
        )
          throw new Error('Invalid membership token response.');
        if (!controller.signal.aborted) {
          setToken(value.token || '');
          setStoredToken(value.token || '');
          setStored(!!value.token);
        }
      })
      .catch(caught => {
        if (!controller.signal.aborted) setError(settingsError(caught));
      });
    return () => controller.abort();
  }, []);
  async function save(method: 'POST' | 'DELETE') {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      if (
        method === 'DELETE' &&
        !(await confirm({
          title: 'Delete membership API key?',
          description: 'Remove stored membership credentials.',
          actionLabel: 'Delete',
        }))
      )
        return;
      await requestJson('/api/appsettings/membership/token/', {
        method,
        ...(method === 'POST' ? { body: JSON.stringify({ token }) } : {}),
      });
      if (method === 'DELETE') {
        setToken('');
        setStoredToken('');
        setStored(false);
        setProfile(undefined);
      } else {
        setStored(true);
        setStoredToken(token);
        setVisible(false);
      }
      setMessage(method === 'DELETE' ? 'Membership key deleted.' : 'Membership key saved.');
    } catch (caught) {
      setError(settingsError(caught));
    } finally {
      setPending(false);
    }
  }
  async function validate() {
    setPending(true);
    setError('');
    setMessage('');
    try {
      const result = await requestJson<unknown>('/api/appsettings/membership/profile/');
      if (
        !result ||
        typeof result !== 'object' ||
        !('user' in result) ||
        !result.user ||
        typeof result.user !== 'object' ||
        !('username' in result.user) ||
        typeof result.user.username !== 'string' ||
        !('sponsor_tier' in result) ||
        !result.sponsor_tier ||
        typeof result.sponsor_tier !== 'object' ||
        !('name' in result.sponsor_tier) ||
        typeof result.sponsor_tier.name !== 'string' ||
        !('description' in result.sponsor_tier) ||
        typeof result.sponsor_tier.description !== 'string' ||
        !('max_subs' in result.sponsor_tier) ||
        typeof result.sponsor_tier.max_subs !== 'number' ||
        !('subscription_count' in result) ||
        typeof result.subscription_count !== 'number' ||
        !('is_connected' in result) ||
        typeof result.is_connected !== 'boolean'
      )
        throw new Error('Invalid membership profile response.');
      setProfile(result as typeof profile);
    } catch (caught) {
      setError(settingsError(caught));
    } finally {
      setPending(false);
    }
  }
  async function sync() {
    if (pending) return;
    setPending(true);
    setError('');
    setMessage('');
    try {
      if (
        !(await confirm({
          title: 'Sync subscriptions?',
          description:
            'Sync subscriptions to membership service? This may unsubscribe channels from membership service when no longer subscribed here.',
          actionLabel: 'Sync',
        }))
      )
        return;
      await requestJson('/api/appsettings/membership/sync/', { method: 'POST' });
      setMessage('Subscription sync task created.');
    } catch (caught) {
      setError(settingsError(caught));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="grid gap-2 md:col-span-2">
      {dialog}
      <h3 className="font-medium">Membership</h3>
      <p className="text-sm text-muted-foreground">
        Membership API key stays masked until revealed.
      </p>
      <div className="flex flex-wrap gap-2">
        <Input
          type={visible ? 'text' : 'password'}
          autoComplete="off"
          aria-label="Membership API key"
          value={token}
          onChange={event => setToken(event.target.value)}
        />
        <Button variant="outline" onClick={() => setVisible(!visible)}>
          {visible ? 'Hide' : 'Reveal'}
        </Button>
        {token && (
          <Button variant="secondary" disabled={pending} onClick={() => void save('POST')}>
            Save
          </Button>
        )}
        {token !== storedToken && (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => {
              setToken(storedToken);
              setError('');
            }}
          >
            Cancel
          </Button>
        )}
        {stored && (
          <Button variant="outline" disabled={pending} onClick={() => void save('DELETE')}>
            Delete
          </Button>
        )}
      </div>
      {stored && (
        <div className="flex gap-2">
          <Button variant="outline" disabled={pending} onClick={() => void validate()}>
            Validate
          </Button>
          <Button variant="outline" disabled={pending} onClick={() => void sync()}>
            Sync subscriptions
          </Button>
        </div>
      )}
      {profile && (
        <p className="text-sm">
          Username: {profile.user.username}. Tier: {profile.sponsor_tier.name} —{' '}
          {profile.sponsor_tier.description}. Subscriptions: {profile.subscription_count}/
          {profile.sponsor_tier.max_subs}. Client connection:{' '}
          {profile.is_connected ? 'Established' : 'Not established'}.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-foreground">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Sync may remove channels from membership service if no longer subscribed locally.
      </p>
    </div>
  );
}
export default SettingsApplication;
