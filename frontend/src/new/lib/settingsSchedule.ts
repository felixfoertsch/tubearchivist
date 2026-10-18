export function scheduleTimestamp(value: string | null | undefined): string {
  if (!value) return 'Never';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return 'Unknown time';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Unknown time'
    : `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function schedulePayload(schedule: string, key?: 'days' | 'rotate', value?: string) {
  const cron = schedule.trim();
  if (!cron) throw new Error('Enter a schedule or auto. Use Delete to disable scheduling.');
  if (cron !== 'auto') {
    const fields = cron.split(/\s+/);
    if (fields.length !== 3 || !/^\d+$/.test(fields[0]) || Number(fields[0]) > 59)
      throw new Error('Use minute (0–59), hour, weekday; for example 0 15 *.');
  }
  return key ? { schedule: cron, ...scheduleConfig(key, value) } : { schedule: cron };
}

export function scheduleConfig(key: 'days' | 'rotate', value?: string) {
  if (!value || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new Error('Enter a non-negative whole number.');
  return { config: { [key]: Number(value) } };
}
