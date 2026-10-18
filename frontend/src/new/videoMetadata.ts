export function isoDate(value: string | number): string {
  if (/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(String(value))) return String(value).slice(0, 10);
  // Video indexing stores either YYYY-MM-DD or a Unix timestamp in seconds.
  const timestamp = Number(value);
  const date = Number.isFinite(timestamp) ? new Date(timestamp * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown date' : date.toISOString().slice(0, 10);
}

export function duration(value: number): string {
  const total = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  const seconds = String(total % 60).padStart(2, '0');
  const minutes = Math.floor(total / 60) % 60;
  return total >= 3600
    ? `${Math.floor(total / 3600)}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}

export function progress(position: number, length: number): number {
  return Number.isFinite(position) && Number.isFinite(length) && length > 0
    ? Math.min(100, Math.max(0, (position / length) * 100))
    : 0;
}
