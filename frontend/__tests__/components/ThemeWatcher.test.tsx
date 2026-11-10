import { render, act } from '@testing-library/react';

import { ThemeWatcher } from '@/components/ThemeWatcher';

import { THEME_BOOT_RECORD_ATTRIBUTE, THEME_STORAGE_KEY } from '@/utils/themeInitScript';
import { saveThemePreference, themeChoice } from '@/utils/themePreference';

const STORAGE_KEY = 'theme-preference';
const choiceRecord = (preference: string, __savedAt: number) => JSON.stringify({ preference, __savedAt });
const sendThemeEvent = (newValue: string) => {
  window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue, storageArea: localStorage }));
};

type MockOptions = { legacy?: boolean };

// Controllable matchMedia mock: lets a test flip `matches` (optionally firing a
// `change` event) and inspect the registered listeners.
function installMatchMediaMock(initialMatches: boolean, options: MockOptions = {}) {
  const state = { matches: initialMatches };
  const changeListeners = new Set<(ev: MediaQueryListEvent) => void>();
  const removeEventListener = jest.fn((_t: string, l: (ev: MediaQueryListEvent) => void) => {
    changeListeners.delete(l);
  });
  const removeListener = jest.fn((l: (ev: MediaQueryListEvent) => void) => {
    changeListeners.delete(l);
  });

  window.matchMedia = jest.fn().mockImplementation((query: string) => {
    const base = {
      media: query,
      get matches() {
        return state.matches;
      },
    } as Record<string, unknown>;

    if (options.legacy) {
      // Legacy Safari API only: no addEventListener/removeEventListener.
      base.addListener = jest.fn((l: (ev: MediaQueryListEvent) => void) => changeListeners.add(l));
      base.removeListener = removeListener;
    } else {
      base.addEventListener = jest.fn(
        (_t: string, l: (ev: MediaQueryListEvent) => void) => changeListeners.add(l),
      );
      base.removeEventListener = removeEventListener;
    }
    return base;
  }) as unknown as typeof window.matchMedia;

  return {
    changeListeners,
    removeEventListener,
    removeListener,
    setMatches(next: boolean) {
      state.matches = next;
      act(() => {
        changeListeners.forEach((l) => l({ matches: next } as MediaQueryListEvent));
      });
    },
    // Flip the OS value without firing a `change` event (simulates the
    // post-wake case where the event is missed and we rely on retries).
    setMatchesSilently(next: boolean) {
      state.matches = next;
    },
  };
}

describe('ThemeWatcher', () => {
  const originalMatchMedia = window.matchMedia;
  const originalHasFocus = document.hasFocus;

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    document.hasFocus = originalHasFocus;
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    document.documentElement.removeAttribute('data-theme-preference');
    document.documentElement.removeAttribute(THEME_BOOT_RECORD_ATTRIBUTE);
    themeChoice.resetForTests();
  });

  it('applies dark on mount when preference is system and OS prefers dark', () => {
    localStorage.setItem(STORAGE_KEY, 'system');
    installMatchMediaMock(true);

    render(<ThemeWatcher />);

    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('follows a live OS theme change when preference is system', () => {
    localStorage.setItem(STORAGE_KEY, 'system');
    const mq = installMatchMediaMock(false);

    render(<ThemeWatcher />);
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    // OS switches to dark while the app is already open.
    mq.setMatches(true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    // ...and back to light.
    mq.setMatches(false);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('defaults to system following when no preference is stored', () => {
    const mq = installMatchMediaMock(false);

    render(<ThemeWatcher />);
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    mq.setMatches(true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('does not follow the OS when preference is an explicit light', () => {
    localStorage.setItem(STORAGE_KEY, 'light');
    const mq = installMatchMediaMock(true);

    render(<ThemeWatcher />);
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    mq.setMatches(true); // OS already dark; explicit light must win
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('keeps dark for an explicit dark preference regardless of OS', () => {
    localStorage.setItem(STORAGE_KEY, 'dark');
    const mq = installMatchMediaMock(false);

    render(<ThemeWatcher />);
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    mq.setMatches(false); // OS light; explicit dark must win
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('keeps the displayed explicit preference when storage returns an older value on focus', () => {
    jest.useFakeTimers();
    localStorage.setItem(STORAGE_KEY, 'dark');
    document.documentElement.setAttribute('data-theme-preference', 'dark');
    installMatchMediaMock(false);
    render(<ThemeWatcher />);
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    const read = Storage.prototype.getItem;
    const stale = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
      return key === STORAGE_KEY ? 'light' : read.call(this, key);
    });
    try {
      act(() => {
        document.hasFocus = () => true;
        window.dispatchEvent(new Event('focus'));
        jest.advanceTimersByTime(1_000);
      });
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(read.call(localStorage, STORAGE_KEY)).toBe('dark');
    } finally {
      stale.mockRestore();
      jest.useRealTimers();
    }
  });

  it('applies a newer choice saved between the first paint and hydration', () => {
    document.documentElement.setAttribute('data-theme-preference', 'dark');
    document.documentElement.setAttribute(THEME_BOOT_RECORD_ATTRIBUTE, choiceRecord('dark', 10));
    document.documentElement.classList.add('dark');
    localStorage.setItem(THEME_STORAGE_KEY, choiceRecord('light', 20));
    installMatchMediaMock(false);

    render(<ThemeWatcher />);

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.getAttribute('data-theme-preference')).toBe('light');
  });

  it('keeps a newer first-paint choice when the hydration read is stale', () => {
    document.documentElement.setAttribute('data-theme-preference', 'dark');
    document.documentElement.setAttribute(THEME_BOOT_RECORD_ATTRIBUTE, choiceRecord('dark', 20));
    localStorage.setItem(THEME_STORAGE_KEY, choiceRecord('light', 10));
    installMatchMediaMock(false);

    render(<ThemeWatcher />);

    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('follows a newer tab event even while storage still returns the previous record', () => {
    localStorage.setItem(THEME_STORAGE_KEY, choiceRecord('dark', 10));
    installMatchMediaMock(false);
    render(<ThemeWatcher />);

    act(() => sendThemeEvent(choiceRecord('light', 20)));

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.getAttribute('data-theme-preference')).toBe('light');
  });

  it('ignores an older tab event even if storage still returns its value', () => {
    localStorage.setItem(THEME_STORAGE_KEY, choiceRecord('light', 10));
    installMatchMediaMock(false);
    render(<ThemeWatcher />);
    act(() => saveThemePreference('dark'));
    localStorage.setItem(THEME_STORAGE_KEY, choiceRecord('light', 20));

    act(() => sendThemeEvent(choiceRecord('light', 20)));

    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('keeps the current choice through an undated clear and starts fresh on reload', () => {
    document.documentElement.setAttribute('data-theme-preference', 'dark');
    document.documentElement.setAttribute(THEME_BOOT_RECORD_ATTRIBUTE, choiceRecord('dark', 20));
    localStorage.setItem(THEME_STORAGE_KEY, choiceRecord('dark', 20));
    installMatchMediaMock(false);
    const { unmount } = render(<ThemeWatcher />);
    localStorage.clear();

    act(() => window.dispatchEvent(new StorageEvent('storage', { storageArea: localStorage })));

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    unmount();
    document.documentElement.removeAttribute(THEME_BOOT_RECORD_ATTRIBUTE);
    themeChoice.resetForTests();
    render(<ThemeWatcher />);
    expect(document.documentElement.getAttribute('data-theme-preference')).toBe('system');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('keeps the legacy first-paint choice when a dated record is malformed', () => {
    document.documentElement.setAttribute(THEME_BOOT_RECORD_ATTRIBUTE, 'dark');
    localStorage.setItem(THEME_STORAGE_KEY, choiceRecord('invalid', 100));
    installMatchMediaMock(false);
    render(<ThemeWatcher />);

    expect(document.documentElement.classList.contains('dark')).toBe(true);

    act(() => sendThemeEvent(choiceRecord('light', 20)));
    expect(document.documentElement.getAttribute('data-theme-preference')).toBe('light');
  });

  it('re-syncs via progressive retries on visibilitychange (device wake)', () => {
    jest.useFakeTimers();
    localStorage.setItem(STORAGE_KEY, 'system');
    const mq = installMatchMediaMock(false);

    render(<ThemeWatcher />);
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    // OS switched to dark while asleep; the `change` event was missed.
    mq.setMatchesSilently(true);

    act(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Still light until the first retry fires.
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    act(() => {
      jest.advanceTimersByTime(50);
    });
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    jest.useRealTimers();
  });

  it('re-syncs on window focus when the tab regains focus', () => {
    jest.useFakeTimers();
    document.hasFocus = jest.fn().mockReturnValue(true);
    localStorage.setItem(STORAGE_KEY, 'system');
    const mq = installMatchMediaMock(false);

    render(<ThemeWatcher />);
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    mq.setMatchesSilently(true);

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    act(() => {
      jest.advanceTimersByTime(50);
    });

    expect(document.documentElement.classList.contains('dark')).toBe(true);

    jest.useRealTimers();
  });

  it('supports the legacy addListener/removeListener API and cleans up', () => {
    localStorage.setItem(STORAGE_KEY, 'system');
    const mq = installMatchMediaMock(false, { legacy: true });

    const { unmount } = render(<ThemeWatcher />);

    // Live change still works through the legacy listener.
    mq.setMatches(true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    unmount();
    expect(mq.removeListener).toHaveBeenCalled();
  });

  it('removes the change listener on unmount', () => {
    localStorage.setItem(STORAGE_KEY, 'system');
    const mq = installMatchMediaMock(false);

    const { unmount } = render(<ThemeWatcher />);
    expect(mq.changeListeners.size).toBe(1);

    unmount();
    expect(mq.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    expect(mq.changeListeners.size).toBe(0);
  });
});
