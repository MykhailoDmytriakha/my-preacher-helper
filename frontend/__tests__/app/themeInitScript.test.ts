/**
 * Tests for the theme initialization script that runs before React hydrates.
 * This script prevents Flash of Incorrect Theme (FOIT) by applying the saved
 * theme preference immediately when the page loads.
 *
 * The actual script is inlined in layout.tsx, but we test its logic here.
 */

const STORAGE_KEY = 'theme-preference';

// Extract the theme initialization logic for testing
function executeThemeInitScript(options: {
  storedPreference: string | null;
  systemPrefersDark: boolean;
  matchMediaSupported?: boolean;
}): { shouldBeDark: boolean; preference: string } {
  const { storedPreference, systemPrefersDark, matchMediaSupported = true } = options;

  // Simulate the script logic
  const stored = storedPreference;
  const preference = (stored === 'light' || stored === 'dark' || stored === 'system') ? stored : 'system';
  const prefersDark = matchMediaSupported ? systemPrefersDark : false;
  const shouldBeDark = preference === 'dark' || (preference === 'system' && prefersDark);

  return { shouldBeDark, preference };
}

describe('Theme Initialization Script Logic', () => {
  describe('preference resolution', () => {
    it('should default to "system" when no stored preference', () => {
      const result = executeThemeInitScript({
        storedPreference: null,
        systemPrefersDark: false,
      });
      expect(result.preference).toBe('system');
    });

    it('should use "dark" when stored as dark', () => {
      const result = executeThemeInitScript({
        storedPreference: 'dark',
        systemPrefersDark: false,
      });
      expect(result.preference).toBe('dark');
    });

    it('should use "light" when stored as light', () => {
      const result = executeThemeInitScript({
        storedPreference: 'light',
        systemPrefersDark: true,
      });
      expect(result.preference).toBe('light');
    });

    it('should use "system" when stored as system', () => {
      const result = executeThemeInitScript({
        storedPreference: 'system',
        systemPrefersDark: false,
      });
      expect(result.preference).toBe('system');
    });

    it('should fallback to "system" for invalid stored values', () => {
      const result = executeThemeInitScript({
        storedPreference: 'invalid',
        systemPrefersDark: false,
      });
      expect(result.preference).toBe('system');
    });

    it('should fallback to "system" for empty string', () => {
      const result = executeThemeInitScript({
        storedPreference: '',
        systemPrefersDark: false,
      });
      expect(result.preference).toBe('system');
    });
  });

  describe('dark mode determination', () => {
    it('should apply dark when preference is "dark"', () => {
      const result = executeThemeInitScript({
        storedPreference: 'dark',
        systemPrefersDark: false,
      });
      expect(result.shouldBeDark).toBe(true);
    });

    it('should not apply dark when preference is "light"', () => {
      const result = executeThemeInitScript({
        storedPreference: 'light',
        systemPrefersDark: true, // Even if system prefers dark
      });
      expect(result.shouldBeDark).toBe(false);
    });

    it('should apply dark when preference is "system" and system prefers dark', () => {
      const result = executeThemeInitScript({
        storedPreference: 'system',
        systemPrefersDark: true,
      });
      expect(result.shouldBeDark).toBe(true);
    });

    it('should not apply dark when preference is "system" and system prefers light', () => {
      const result = executeThemeInitScript({
        storedPreference: 'system',
        systemPrefersDark: false,
      });
      expect(result.shouldBeDark).toBe(false);
    });

    it('should apply dark when no stored preference and system prefers dark', () => {
      const result = executeThemeInitScript({
        storedPreference: null,
        systemPrefersDark: true,
      });
      expect(result.shouldBeDark).toBe(true);
    });

    it('should not apply dark when no stored preference and system prefers light', () => {
      const result = executeThemeInitScript({
        storedPreference: null,
        systemPrefersDark: false,
      });
      expect(result.shouldBeDark).toBe(false);
    });
  });

  describe('matchMedia fallback', () => {
    it('should default to light theme when matchMedia is not supported', () => {
      const result = executeThemeInitScript({
        storedPreference: 'system',
        systemPrefersDark: true,
        matchMediaSupported: false,
      });
      expect(result.shouldBeDark).toBe(false);
    });

    it('should still respect explicit dark preference when matchMedia is not supported', () => {
      const result = executeThemeInitScript({
        storedPreference: 'dark',
        systemPrefersDark: false,
        matchMediaSupported: false,
      });
      expect(result.shouldBeDark).toBe(true);
    });

    it('should still respect explicit light preference when matchMedia is not supported', () => {
      const result = executeThemeInitScript({
        storedPreference: 'light',
        systemPrefersDark: true,
        matchMediaSupported: false,
      });
      expect(result.shouldBeDark).toBe(false);
    });
  });
});

describe('Theme Initialization DOM Integration', () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    document.documentElement.removeAttribute('data-theme-preference');
    originalMatchMedia = window.matchMedia;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  // Simulates what the inline script does
  function runInlineScript() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const preference = (stored === 'light' || stored === 'dark' || stored === 'system') ? stored : 'system';
      const prefersDark = typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
        : false;
      const shouldBeDark = preference === 'dark' || (preference === 'system' && prefersDark);

      if (shouldBeDark) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      document.documentElement.setAttribute('data-theme-preference', preference);
    } catch {
      // Silently fail - matches the real script behavior
    }
  }

  it('should add dark class when localStorage has dark preference', () => {
    localStorage.setItem(STORAGE_KEY, 'dark');

    runInlineScript();

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.getAttribute('data-theme-preference')).toBe('dark');
  });

  it('should not add dark class when localStorage has light preference', () => {
    localStorage.setItem(STORAGE_KEY, 'light');
    document.documentElement.classList.add('dark'); // Pre-existing

    runInlineScript();

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.getAttribute('data-theme-preference')).toBe('light');
  });

  it('should add dark class when system prefers dark and preference is system', () => {
    localStorage.setItem(STORAGE_KEY, 'system');

    window.matchMedia = jest.fn().mockImplementation(() => ({
      matches: true, // System prefers dark
    }));

    runInlineScript();

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.getAttribute('data-theme-preference')).toBe('system');
  });

  it('should not add dark class when system prefers light and preference is system', () => {
    localStorage.setItem(STORAGE_KEY, 'system');

    window.matchMedia = jest.fn().mockImplementation(() => ({
      matches: false, // System prefers light
    }));

    runInlineScript();

    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('should default to system preference when localStorage is empty', () => {
    // No localStorage set

    window.matchMedia = jest.fn().mockImplementation(() => ({
      matches: true, // System prefers dark
    }));

    runInlineScript();

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.getAttribute('data-theme-preference')).toBe('system');
  });

  it('should handle missing matchMedia gracefully', () => {
    localStorage.setItem(STORAGE_KEY, 'system');

    // Remove matchMedia
    (window as any).matchMedia = undefined;

    runInlineScript();

    // Should not crash and should default to light (no dark class)
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('should handle localStorage errors gracefully', () => {
    // Mock localStorage.getItem to throw
    const originalGetItem = localStorage.getItem;
    localStorage.getItem = jest.fn(() => {
      throw new Error('localStorage is disabled');
    });

    expect(() => runInlineScript()).not.toThrow();

    localStorage.getItem = originalGetItem;
  });
});
