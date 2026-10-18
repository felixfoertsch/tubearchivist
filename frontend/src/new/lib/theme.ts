export type Theme = 'system' | 'light' | 'dark';

export function readTheme(): Theme {
  try {
    const value = localStorage.getItem('ta-new-theme');
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle(
    'dark',
    theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches),
  );
}
