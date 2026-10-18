import updateUserConfig, { type UserConfigType } from '../../api/actions/updateUserConfig';

type Response = { status: number; data?: UserConfigType; error?: { error?: string } };

export function pageSizePayload(value: string): { page_size: number } {
  const pageSize = Number(value);
  if (
    !value.trim() ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > Number.MAX_SAFE_INTEGER
  )
    throw new Error('Page size must be a positive safe whole number.');
  return { page_size: pageSize };
}

export function checkedUserConfig(response: Response): UserConfigType {
  if (response.status < 200 || response.status >= 300 || response.error || !response.data)
    throw new Error(
      response.error?.error || `User preferences request failed (${response.status})`,
    );
  const data = response.data;
  if (
    !['dark.css', 'light.css', 'matrix.css', 'midnight.css', 'custom.css'].includes(
      data.stylesheet,
    ) ||
    !Number.isFinite(data.page_size) ||
    typeof data.show_help_text !== 'boolean' ||
    !['binary', 'metric'].includes(data.file_size_unit)
  )
    throw new Error('User preferences response invalid');
  return data;
}

export async function saveUserSettings(values: Partial<UserConfigType>) {
  return checkedUserConfig(await updateUserConfig(values));
}
