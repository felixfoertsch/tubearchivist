import type { PaginationType } from '../components/Pagination';

export function requestedPage(value: string | null, pageSize: number): number | null {
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 0 && page <= Math.ceil(10000 / Math.max(1, pageSize))
    ? page
    : null;
}

export function nextPage(pagination?: PaginationType): number | undefined {
  if (!pagination) return;
  const current = Math.max(1, pagination.current_page);
  return (
    (pagination.next_pages as number[] | undefined)?.find(page => page > current) ||
    (pagination.last_page && pagination.last_page > current ? current + 1 : undefined)
  );
}
