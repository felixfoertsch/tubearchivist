import type { BackupListType } from '../../api/loader/loadBackupList';
import getApiUrl from '../../configuration/getApiUrl';
import getFetchCredentials from '../../configuration/getFetchCredentials';
import { isoDateTime } from './settingsApplication';

export function backupDate(value: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (!match) return 'Unknown date';
  const iso = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`;
  const date = new Date(iso);
  return !Number.isFinite(date.getTime()) || date.toISOString() !== iso.replace('Z', '.000Z')
    ? 'Unknown date'
    : isoDateTime(iso);
}

export function validateBackups(value: unknown): BackupListType {
  if (
    !Array.isArray(value) ||
    !value.every(
      item =>
        item &&
        typeof item.filename === 'string' &&
        /^ta_backup-\d{8}T\d{6}Z-(auto|manual|update)\.dump$/.test(item.filename) &&
        typeof item.timestamp === 'string' &&
        backupDate(item.timestamp) !== 'Unknown date' &&
        ['auto', 'manual', 'update'].includes(item.reason) &&
        Number.isSafeInteger(item.file_size) &&
        item.file_size >= 0,
    )
  )
    throw new Error('Invalid database backup list returned by server.');
  return value;
}

export async function downloadBackup(filename: string): Promise<void> {
  const response = await fetch(
    `${getApiUrl()}/api/appsettings/backup/${encodeURIComponent(filename)}/download/`,
    {
      credentials: getFetchCredentials(),
    },
  );
  if (!response.ok) throw new Error(`Database backup download failed (${response.status}).`);
  const url = URL.createObjectURL(await response.blob());
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
