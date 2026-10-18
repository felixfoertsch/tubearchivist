import APIClient, { type ApiClientOptions } from '../../functions/APIClient';

export async function requestJson<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await APIClient<T>(path, {
    ...init,
    method: (init.method || 'GET') as ApiClientOptions['method'],
    body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
  } as ApiClientOptions);
  if (response.status < 200 || response.status >= 300 || response.error)
    throw new Error(response.error?.error || `Request failed (${response.status})`);
  return response.data as T;
}

export function objectData(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Server returned an invalid object. Reload to retry.');
  return value as Record<string, unknown>;
}

export function settingsError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string')
    return error.message;
  return 'Request failed. Try again.';
}
