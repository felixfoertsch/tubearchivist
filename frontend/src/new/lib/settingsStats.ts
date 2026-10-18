export function statsProgress(value: number): string {
  return new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 }).format(
    value,
  );
}

export type StatValue = string | number | null | StatRecord | StatValue[];
export type StatRecord = { [key: string]: StatValue };
export function validateStats(value: unknown, required: string[] = []): StatRecord | StatValue[] {
  function valid(item: unknown): item is StatValue {
    if (item === null) return true;
    if (typeof item === 'number') return Number.isFinite(item) && item >= 0;
    if (typeof item === 'string') return true;
    if (Array.isArray(item)) return item.every(valid);
    return !!item && typeof item === 'object' && Object.values(item).every(valid);
  }
  if (!value || typeof value !== 'object' || !valid(value))
    throw new Error('Invalid statistics returned by server.');
  if (required.length && (Array.isArray(value) || required.some(key => !(key in value))))
    throw new Error('Statistics response is missing required fields.');
  return value as StatRecord | StatValue[];
}
