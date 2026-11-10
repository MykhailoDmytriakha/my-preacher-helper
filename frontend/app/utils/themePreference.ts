import { deviceChoice } from './deviceChoice';
import { LEGACY_THEME_STORAGE_KEY, THEME_BOOT_RECORD_ATTRIBUTE, THEME_PREFERENCE_ATTRIBUTE, THEME_STORAGE_KEY } from './themeInitScript';

export type ThemePreference = 'light' | 'dark' | 'system';

export const THEME_MEDIA_QUERY = '(prefers-color-scheme: dark)';

const isThemePreference = (value: unknown): value is ThemePreference =>
  value === 'light' || value === 'dark' || value === 'system';

function recordedPreference(raw: string | null): ThemePreference | null {
  try {
    const record = JSON.parse(raw ?? 'null') as { preference?: unknown; __savedAt?: unknown } | null;
    if (isThemePreference(record?.preference) && typeof record.__savedAt === 'number'
      && Number.isFinite(record.__savedAt) && record.__savedAt > 0) return record.preference;
  } catch {
    // A malformed record cannot replace a valid older format.
  }
  return null;
}

export const themeChoice = deviceChoice({
  key: THEME_STORAGE_KEY,
  parse: raw => ({ preference: isThemePreference(raw) ? raw : recordedPreference(raw) ?? 'system' }),
  fallback: { preference: 'system' },
  firstPaint: {
    accepts: raw => recordedPreference(raw) !== null,
    read: () => {
      const boot = document.documentElement.getAttribute(THEME_BOOT_RECORD_ATTRIBUTE);
      if (boot !== null) return boot;
      try {
        return window.localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
      } catch {
        return null;
      }
    },
  },
});

export function applyTheme(): void {
  const { preference } = themeChoice.read();
  const systemDark = preference === 'system' && typeof window.matchMedia === 'function'
    && window.matchMedia(THEME_MEDIA_QUERY).matches;
  const root = document.documentElement;
  root.setAttribute(THEME_PREFERENCE_ATTRIBUTE, preference);
  root.classList.toggle('dark', preference === 'dark' || systemDark);
}

export function saveThemePreference(preference: ThemePreference): void {
  const kept = themeChoice.save({ preference });
  applyTheme();
  if (kept !== 'kept') return;
  try {
    // Keep the old first-paint script working in a tab that still runs the previous bundle.
    window.localStorage.setItem(LEGACY_THEME_STORAGE_KEY, preference);
  } catch {
    // The dated record already contains the durable choice.
  }
}
