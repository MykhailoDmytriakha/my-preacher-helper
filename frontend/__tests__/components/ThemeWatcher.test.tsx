import { render, act } from '@testing-library/react';

import { ThemeWatcher } from '@/components/ThemeWatcher';

const STORAGE_KEY = 'theme-preference';

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
