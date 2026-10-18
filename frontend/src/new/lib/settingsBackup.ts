export function backupDate(value: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (!match) return 'Unknown date';
  const iso = `${match[1]}-${match[2]}-${match[3]}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso
    ? 'Unknown date'
    : iso;
}
