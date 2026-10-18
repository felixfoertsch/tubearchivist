import NewRoutes from '../routes';

const knownPath =
  /^\/new\/(?:$|channel\/(?:[\w-]+(?:\/(?:streams\/|shorts\/|playlist\/|about\/)?)?)?$|playlist\/(?:[\w-]+\/?)?$|video\/[\w-]+\/?$|(?:downloads|search|dashboard)\/?$|settings\/(?:user\/|application\/|scheduling\/|actions\/)?$)/;

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
    if (url.origin !== 'https://return.invalid' || !value.startsWith('/new/'))
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

export function classicHref(value: string): string {
  if (value.split(/[?#]/, 1)[0] === NewRoutes.Login) return '/login/';
  const safe = safeReturnTo(value);
  if (safe !== value) return '/';
  const url = new URL(safe, 'https://return.invalid');
  if (/^\/new\/dashboard\/?$/.test(url.pathname)) return `/settings/${url.search}`;
  if (/^\/new\/settings\/?$/.test(url.pathname)) {
    const section = ['user', 'application', 'scheduling', 'actions'].includes(url.hash.slice(1))
      ? url.hash.slice(1)
      : 'user';
    return `/settings/${section}/${url.search}`;
  }
  if (/^\/new\/settings\/(user|application|scheduling|actions)\/$/.test(url.pathname))
    return `${url.pathname.slice(4)}${url.search}`;
  return value.slice(4);
}
