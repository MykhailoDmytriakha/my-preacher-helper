/**
 * The inline theme script that runs before React hydrates, tested by running THE REAL TEXT that
 * app/layout.tsx renders into <head> (BUG-20260929-tests-check-their-own-copy: this file used to
 * test a copy of its logic, so breaking the real script left it green).
 */
import { THEME_BOOT_RECORD_ATTRIBUTE, THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from '@/utils/themeInitScript';

const STORAGE_KEY = 'theme-preference';

function runThemeScript() {
  // The script is plain JavaScript text: execute it the way the browser does.
  new Function(THEME_INIT_SCRIPT)();
}

function systemPrefersDark(dark: boolean) {
  window.matchMedia = jest.fn().mockImplementation(() => ({ matches: dark })) as unknown as typeof window.matchMedia;
}

describe('theme initialization script', () => {
  let originalMatchMedia: typeof window.matchMedia;
  const root = () => document.documentElement;

  beforeEach(() => {
    localStorage.clear();
    root().classList.remove('dark');
    root().removeAttribute('data-theme-preference');
    root().removeAttribute(THEME_BOOT_RECORD_ATTRIBUTE);
    originalMatchMedia = window.matchMedia;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  describe('preference resolution', () => {
    it.each([
      [null, 'system'],
      ['dark', 'dark'],
      ['light', 'light'],
      ['system', 'system'],
      ['invalid', 'system'],
      ['', 'system'],
      ['DARK', 'system'],
    ])('stored %p resolves to %p', (stored, expected) => {
      systemPrefersDark(false);
      if (stored !== null) localStorage.setItem(STORAGE_KEY, stored);

      runThemeScript();

      expect(root().getAttribute('data-theme-preference')).toBe(expected);
    });
  });

  it('applies and exposes the dated preference before hydration', () => {
    systemPrefersDark(false);
    localStorage.setItem(STORAGE_KEY, 'light');
    const stored = JSON.stringify({ preference: 'dark', __savedAt: 123 });
    localStorage.setItem(THEME_STORAGE_KEY, stored);

    runThemeScript();

    expect(root().getAttribute(THEME_BOOT_RECORD_ATTRIBUTE)).toBe(stored);
    expect(root().getAttribute('data-theme-preference')).toBe('dark');
    expect(root().classList.contains('dark')).toBe(true);
  });

  describe('dark mode determination', () => {
    it.each([
      ['dark', false, true],
      ['dark', true, true],
      ['light', true, false],
      ['light', false, false],
      ['system', true, true],
      ['system', false, false],
    ])('stored %p with the system preferring dark=%p gives dark=%p', (stored, systemDark, dark) => {
      systemPrefersDark(systemDark);
      localStorage.setItem(STORAGE_KEY, stored);

      runThemeScript();

      expect(root().classList.contains('dark')).toBe(dark);
    });

    it('removes a dark class left from before when the preference is light', () => {
      systemPrefersDark(true);
      localStorage.setItem(STORAGE_KEY, 'light');
      root().classList.add('dark');

      runThemeScript();

      expect(root().classList.contains('dark')).toBe(false);
    });

    it('follows a dark system when nothing is stored', () => {
      systemPrefersDark(true);

      runThemeScript();

      expect(root().classList.contains('dark')).toBe(true);
      expect(root().getAttribute('data-theme-preference')).toBe('system');
    });
  });

  describe('fallbacks', () => {
    it('stays light and does not fail when matchMedia is missing', () => {
      localStorage.setItem(STORAGE_KEY, 'system');
      (window as unknown as { matchMedia?: unknown }).matchMedia = undefined;

      expect(() => runThemeScript()).not.toThrow();
      expect(root().classList.contains('dark')).toBe(false);
      expect(root().getAttribute('data-theme-preference')).toBe('system');
    });

    it('still honours an explicit dark preference when matchMedia is missing', () => {
      localStorage.setItem(STORAGE_KEY, 'dark');
      (window as unknown as { matchMedia?: unknown }).matchMedia = undefined;

      runThemeScript();

      expect(root().classList.contains('dark')).toBe(true);
    });

    it('does not throw when storage itself is unavailable', () => {
      const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });

      expect(() => runThemeScript()).not.toThrow();
      getItem.mockRestore();
    });
  });
});
