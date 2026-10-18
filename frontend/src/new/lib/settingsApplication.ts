import APIClient from '../../functions/APIClient';
import type { AppSettingsConfigType } from '../../api/loader/loadAppsettingsConfig';
import type { SnapshotListType } from '../../api/loader/loadSnapshots';
import type { CookieStateType } from '../../api/loader/loadCookie';
import { useAppSettingsStore } from '../../stores/AppSettingsStore';

type ApiResponse<T> = { status: number; data?: T; error?: { error?: string } };
export function requireData<T>(response: ApiResponse<T>, name: string): T {
  if (
    response.status < 200 ||
    response.status >= 300 ||
    response.error ||
    response.data === undefined
  )
    throw new Error(response.error?.error || `${name} request failed (${response.status})`);
  return response.data;
}
function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Invalid ${name} response.`);
  return value as Record<string, unknown>;
}
function nullableNumber(value: unknown) {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}
export function validateAppSettings(value: unknown): AppSettingsConfigType {
  const root = record(value, 'application settings');
  const subscriptions = record(root.subscriptions, 'subscriptions');
  const downloads = record(root.downloads, 'downloads');
  const application = record(root.application, 'application');
  for (const key of ['channel_size', 'live_channel_size', 'shorts_channel_size', 'playlist_size'])
    if (!nullableNumber(subscriptions[key])) throw new Error(`Invalid subscriptions.${key}.`);
  for (const key of ['auto_start', 'extract_flat'])
    if (typeof subscriptions[key] !== 'boolean') throw new Error(`Invalid subscriptions.${key}.`);
  for (const key of ['limit_speed', 'sleep_interval', 'autodelete_days', 'throttledratelimit'])
    if (!nullableNumber(downloads[key])) throw new Error(`Invalid downloads.${key}.`);
  for (const key of [
    'format',
    'format_sort',
    'subtitle',
    'subtitle_source',
    'comment_max',
    'pot_provider_url',
    'extractor_lang',
  ])
    if (downloads[key] !== null && typeof downloads[key] !== 'string')
      throw new Error(`Invalid downloads.${key}.`);
  if (!(typeof downloads.add_metadata === 'boolean' || downloads.add_metadata === 'simple'))
    throw new Error('Invalid downloads.add_metadata.');
  for (const key of ['subtitle_index', 'cookie_import', 'integrate_ryd', 'integrate_sponsorblock'])
    if (typeof downloads[key] !== 'boolean') throw new Error(`Invalid downloads.${key}.`);
  if (
    (downloads.comment_sort !== null && !['top', 'new'].includes(String(downloads.comment_sort))) ||
    typeof application.enable_snapshot !== 'boolean' ||
    typeof application.enable_cast !== 'boolean'
  )
    throw new Error('Invalid application settings values.');
  return value as AppSettingsConfigType;
}
export function validateSnapshots(value: unknown): SnapshotListType {
  const data = record(value, 'snapshots');
  if (
    typeof data.next_exec !== 'number' ||
    !Number.isFinite(data.next_exec) ||
    typeof data.expire_after !== 'string'
  )
    throw new Error('Invalid snapshot metadata.');
  if (
    data.snapshots !== undefined &&
    data.snapshots !== false &&
    (!Array.isArray(data.snapshots) ||
      !data.snapshots.every(item => {
        const snapshot = record(item, 'snapshot');
        return (
          typeof snapshot.id === 'string' &&
          typeof snapshot.state === 'string' &&
          typeof snapshot.duration_s === 'number' &&
          Number.isFinite(snapshot.duration_s) &&
          typeof snapshot.end_stamp === 'number' &&
          Number.isFinite(snapshot.end_stamp)
        );
      }))
  )
    throw new Error('Invalid snapshot list.');
  return data as unknown as SnapshotListType;
}
export function validateCookie(value: unknown): CookieStateType {
  const cookie = record(value, 'cookie');
  if (
    typeof cookie.cookie_enabled !== 'boolean' ||
    (cookie.validated_str !== undefined && typeof cookie.validated_str !== 'string') ||
    (cookie.validated !== undefined &&
      (typeof cookie.validated !== 'number' || !Number.isFinite(cookie.validated)))
  )
    throw new Error('Invalid cookie status.');
  return cookie as unknown as CookieStateType;
}
export function isoDateTime(value: string | number): string {
  let date: Date;
  if (typeof value === 'number')
    date = new Date(Math.abs(value) < 100_000_000_000 ? value * 1000 : value);
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/.test(value))
    date = new Date(value);
  else return 'Unknown';
  if (!Number.isFinite(date.getTime())) return 'Unknown';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
export async function loadApplicationSettings() {
  const [settings, snapshots, token, cookie] = await Promise.all([
    APIClient<unknown>('/api/appsettings/config/'),
    APIClient<unknown>('/api/appsettings/snapshot/'),
    APIClient<unknown>('/api/appsettings/token/'),
    APIClient<unknown>('/api/appsettings/cookie/'),
  ]);
  const tokenData = record(requireData(token, 'API token'), 'API token');
  if (typeof tokenData.token !== 'string' || tokenData.token.length === 0)
    throw new Error('Invalid API token response.');
  return {
    settings: validateAppSettings(requireData(settings, 'Application settings')),
    snapshots: validateSnapshots(requireData(snapshots, 'Snapshots')),
    token: tokenData.token,
    cookie: validateCookie(requireData(cookie, 'Cookie status')),
  };
}
export async function saveApplicationSetting(
  group: 'subscriptions' | 'downloads' | 'application',
  key: string,
  value: string | boolean | number | null,
) {
  const response = await APIClient('/api/appsettings/config/', {
    method: 'POST',
    body: { [group]: { [key]: value } },
  });
  const config = validateAppSettings(requireData(response, 'Save'));
  useAppSettingsStore.getState().setAppSettingsConfig(config);
}
