import NewRoutes from '../routes';

const knownPath =
  /^\/(?:$|channel\/(?:[\w-]+(?:\/(?:streams\/|shorts\/|playlist\/|about\/)?)?)?$|playlist\/(?:[\w-]+\/?)?$|video\/[\w-]+\/?$|(?:downloads|search|dashboard)\/?$|settings\/(?:user\/|application\/|scheduling\/|actions\/)?$)/;

/** Accept known new UI routes only, never protocols, traversal or encoded separators. */
export function safeReturnTo(value: string | null): string {
  if (
    !value ||
    value.includes('\\') ||
    [...value].some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)
  )
    return NewRoutes.Home;
  try {
    const url = new URL(value, 'https://return.invalid');
    if (url.origin !== 'https://return.invalid' || !value.startsWith('/') || value.startsWith('//'))
      return NewRoutes.Home;
    if (!knownPath.test(url.pathname) || url.pathname !== value.split(/[?#]/, 1)[0])
      return NewRoutes.Home;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return NewRoutes.Home;
  }
}

export function loginHref(value: string): string {
  return `${NewRoutes.Login}?next=${encodeURIComponent(safeReturnTo(value))}`;
}
