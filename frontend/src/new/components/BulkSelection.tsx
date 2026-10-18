export function togglePageSelection(selected: string[], page: string[]): string[] {
  return page.every(id => selected.includes(id))
    ? selected.filter(id => !page.includes(id))
    : [...new Set([...selected, ...page])];
}
