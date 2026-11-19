const names = typeof Intl !== 'undefined' && 'DisplayNames' in Intl ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;

export function countryName(code: string | null | undefined): string {
  if (!code) return 'Unknown';
  try {
    return names?.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}
