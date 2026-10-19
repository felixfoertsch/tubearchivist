export type DownloadRecord = {
  auto_start?: boolean;
  channel_id: string;
  channel_indexed: boolean;
  channel_name: string;
  duration: string;
  message?: string;
  published: string | null;
  status?: 'pending' | 'ignore';
  timestamp: number | null;
  title: string;
  vid_thumb_url: string | null;
  vid_type: string;
  youtube_id: string;
  _index?: string;
  _score?: number;
};
export type DownloadResponseType = {
  data: DownloadRecord[];
  paginate: {
    page_size: number;
    page_from: number;
    current_page: number;
    last_page: number | false;
    next_pages: number[] | null;
    prev_pages: number[] | null;
    total_hits: number;
    max_hits: boolean;
    params: string;
  };
};

export function assertDownloadResponse(response: {
  status: number;
  data?: unknown;
  error?: { error: string };
}): DownloadResponseType {
  if (response.error || response.status < 200 || response.status >= 300)
    throw new Error(response.error?.error ?? `Request failed (${response.status})`);
  const payload: unknown = response.data;
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('data' in payload) ||
    !Array.isArray(payload.data)
  )
    throw new Error('Invalid download queue response');
  const items: unknown[] = payload.data;
  if (
    items.some(item => {
      if (!item || typeof item !== 'object') return true;
      const record = item as Record<string, unknown>;
      return (
        typeof record.youtube_id !== 'string' ||
        typeof record.title !== 'string' ||
        typeof record.channel_id !== 'string' ||
        typeof record.channel_name !== 'string' ||
        (record.status !== undefined &&
          record.status !== 'pending' &&
          record.status !== 'ignore') ||
        typeof record.vid_type !== 'string' ||
        typeof record.duration !== 'string' ||
        (record.published !== null && typeof record.published !== 'string') ||
        (record.message !== undefined && typeof record.message !== 'string')
      );
    })
  )
    throw new Error('Invalid download queue item');
  if (!('paginate' in payload)) throw new Error('Invalid download pagination response');
  const pagination: unknown = payload.paginate;
  if (!pagination || typeof pagination !== 'object')
    throw new Error('Invalid download pagination response');
  const page = pagination as Record<string, unknown>;
  const validPages = (value: unknown) =>
    value === null ||
    (Array.isArray(value) && value.every(number => Number.isSafeInteger(number) && number > 0));
  if (
    !Number.isSafeInteger(page.current_page) ||
    (page.current_page as number) < 0 ||
    (page.last_page !== false &&
      (!Number.isSafeInteger(page.last_page) || (page.last_page as number) < 0)) ||
    !Number.isSafeInteger(page.page_size) ||
    (page.page_size as number) <= 0 ||
    !Number.isSafeInteger(page.page_from) ||
    (page.page_from as number) < 0 ||
    !Number.isSafeInteger(page.total_hits) ||
    (page.total_hits as number) < 0 ||
    typeof page.max_hits !== 'boolean' ||
    typeof page.params !== 'string' ||
    !validPages(page.next_pages) ||
    !validPages(page.prev_pages)
  )
    throw new Error('Invalid download pagination response');
  return payload as DownloadResponseType;
}

export function assertTaskNotifications(
  value: unknown,
): import('../../api/loader/loadNotifications').NotificationResponseType {
  if (
    !Array.isArray(value) ||
    value.some(item => {
      if (!item || typeof item !== 'object') return true;
      const task = item as Record<string, unknown>;
      return (
        typeof task.id !== 'string' ||
        typeof task.title !== 'string' ||
        (task.progress !== undefined &&
          (typeof task.progress !== 'number' || !Number.isFinite(task.progress))) ||
        !Array.isArray(task.messages) ||
        task.messages.some((message: unknown) => typeof message !== 'string') ||
        typeof task.api_stop !== 'boolean' ||
        (task.level !== 'info' && task.level !== 'error') ||
        (task.command !== undefined &&
          task.command !== null &&
          typeof task.command !== 'boolean' &&
          task.command !== 'STOP' &&
          task.command !== 'KILL') ||
        (task.youtube_id !== undefined && typeof task.youtube_id !== 'string')
      );
    })
  )
    throw new Error('Invalid task notification response');
  return value as import('../../api/loader/loadNotifications').NotificationResponseType;
}

// finished: every task ended. advanced: finished, or the downloading video changed.
export function taskTransition(
  previous: { youtube_id?: string }[],
  next: { youtube_id?: string }[],
): { finished: boolean; advanced: boolean } {
  const finished = previous.length > 0 && next.length === 0;
  const before = previous.find(task => task.youtube_id)?.youtube_id;
  const after = next.find(task => task.youtube_id)?.youtube_id;
  return { finished, advanced: finished || (before !== undefined && before !== after) };
}

export function taskPercent(progress: number | undefined): number {
  return Math.round(Math.min(1, Math.max(0, progress ?? 0)) * 100);
}

export function pollWhileActive<T>(
  request: () => Promise<T>,
  consume: (value: T) => boolean,
  interval: (busy: boolean) => number,
  onError: (error: unknown) => void,
  schedule: (callback: () => void, delay: number) => ReturnType<typeof setTimeout> = setTimeout,
  cancel: (timer: ReturnType<typeof setTimeout>) => void = clearTimeout,
): () => void {
  let active = true;
  let busy = false;
  let timer: ReturnType<typeof setTimeout>;
  const poll = async () => {
    if (!active) return;
    try {
      const value = await request();
      if (active) busy = consume(value);
    } catch (error) {
      if (active) onError(error);
    } finally {
      if (active) timer = schedule(poll, interval(busy));
    }
  };
  void poll();
  return () => {
    active = false;
    cancel(timer);
  };
}

export function downloadQueryKey(
  page: number,
  channel: string | null,
  type: string | null,
  error: string | null,
  ignored: boolean,
  search: string,
): string {
  return JSON.stringify([page, channel, type, error, ignored, search]);
}

export function downloadPreviousPage(current: number): number | undefined {
  return current > 1 ? current - 1 : undefined;
}

export function downloadBulkScope(
  ignored: boolean,
  channel: string | null,
  type: string | null,
  error?: string | null,
): string {
  return `status: ${ignored ? 'ignore' : 'pending'}; channel: ${channel || 'all'}; type: ${type || 'all'}${error ? `; error: ${error}` : ''}`;
}

export function downloadPage(value: string | null): number {
  if (value === null) return 0;
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 0 ? page : 0;
}
