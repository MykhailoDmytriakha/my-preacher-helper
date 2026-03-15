import { renderHook, act, waitFor } from '@testing-library/react';

import { useThemePreference, type ThemePreference } from '@/hooks/useThemePreference';

const STORAGE_KEY = 'theme-preference';

describe('useThemePreference Hook', () => {
  let originalMatchMedia: typeof window.matchMedia;
  let mockMatchMedia: jest.Mock;

  beforeEach(() => {
    // Clear localStorage and DOM before each test
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    document.documentElement.removeAttribute('data-theme-preference');
    jest.clearAllMocks();

    // Save original matchMedia
    originalMatchMedia = window.matchMedia;

    // Mock matchMedia
    mockMatchMedia = jest.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));
    window.matchMedia = mockMatchMedia;
  });

  afterEach(() => {
    // Restore original matchMedia
    window.matchMedia = originalMatchMedia;
  });

  it('should initialize with system preference by default', async () => {
    const { result } = renderHook(() => useThemePreference());

    // Wait for hook to be ready (useEffect runs)
    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    // Default preference should be 'system' when no localStorage value
    expect(result.current.preference).toBe('system');
  });

  it('should become ready after mount', async () => {
    const { result } = renderHook(() => useThemePreference());

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });
  });

  it('should load dark preference from localStorage', async () => {
    localStorage.setItem(STORAGE_KEY, 'dark');

    const { result } = renderHook(() => useThemePreference());

    await waitFor(() => {
      expect(result.current.preference).toBe('dark');
      expect(result.current.ready).toBe(true);
    });
  });

  it('should load light preference from localStorage', async () => {
    localStorage.setItem(STORAGE_KEY, 'light');

    const { result } = renderHook(() => useThemePreference());

    await waitFor(() => {
      expect(result.current.preference).toBe('light');
    });
  });

  it('should ignore invalid localStorage values', async () => {
    localStorage.setItem(STORAGE_KEY, 'invalid-value');

    const { result } = renderHook(() => useThemePreference());

    await waitFor(() => {
      expect(result.current.preference).toBe('system');
      expect(result.current.ready).toBe(true);
    });
  });

  it('should update preference when setPreference is called', async () => {
    const { result } = renderHook(() => useThemePreference());

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    act(() => {
      result.current.setPreference('dark');
    });

    expect(result.current.preference).toBe('dark');
  });

  it('should persist preference to localStorage when changed', async () => {
    const { result } = renderHook(() => useThemePreference());

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    act(() => {
      result.current.setPreference('light');
    });

    await waitFor(() => {
      expect(localStorage.getItem(STORAGE_KEY)).toBe('light');
    });
  });

  it('should apply dark class to documentElement when preference is dark', async () => {
    const { result } = renderHook(() => useThemePreference());

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    act(() => {
      result.current.setPreference('dark');
    });

    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });
  });

  it('should remove dark class when preference is light', async () => {
    document.documentElement.classList.add('dark');

    const { result } = renderHook(() => useThemePreference());

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    act(() => {
      result.current.setPreference('light');
    });

    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });
  });

  it('should set data-theme-preference attribute on documentElement', async () => {
    const { result } = renderHook(() => useThemePreference());

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    act(() => {
      result.current.setPreference('dark');
    });

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme-preference')).toBe('dark');
    });
  });

  it('should apply dark class when system preference is dark and preference is system', async () => {
    // Mock system prefers dark
    mockMatchMedia.mockImplementation((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)',
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));

    const { result } = renderHook(() => useThemePreference());

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    // Trigger re-evaluation with system preference
    act(() => {
      result.current.setPreference('system');
    });

    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });
  });

  it('should not apply dark class when system prefers light and preference is system', async () => {
    // Mock system prefers light (matches: false)
    mockMatchMedia.mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));

    const { result } = renderHook(() => useThemePreference());

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    act(() => {
      result.current.setPreference('system');
    });

    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });
  });

  it('should cycle through all theme preferences', async () => {
    const { result } = renderHook(() => useThemePreference());

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    const preferences: ThemePreference[] = ['light', 'dark', 'system'];

    for (const pref of preferences) {
      act(() => {
        result.current.setPreference(pref);
      });
      expect(result.current.preference).toBe(pref);
    }
  });

  it('should re-apply system theme on visibilitychange (device wake from sleep)', async () => {
    // Simulate system starts in light mode
    let systemPrefersDark = false;
    const listeners: ((ev: MediaQueryListEvent) => void)[] = [];

    mockMatchMedia.mockImplementation((query: string) => ({
      get matches() {
        return query === '(prefers-color-scheme: dark)' && systemPrefersDark;
      },
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn().mockImplementation((_event: string, cb: (ev: MediaQueryListEvent) => void) => {
        listeners.push(cb);
      }),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));

    const { result } = renderHook(() => useThemePreference());

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    // Ensure system mode is active and starts light
    act(() => {
      result.current.setPreference('system');
    });

    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    // Simulate device goes to sleep → OS switches to dark theme → device wakes
    systemPrefersDark = true;

    // Trigger visibilitychange (page becomes visible again after device wake)
    act(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });
  });

  it('should fallback correctly when matchMedia is not a function', async () => {
    // @ts-ignore - simulating env where matchMedia is missing
    delete (window as any).matchMedia;

    const { result } = renderHook(() => useThemePreference());

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    act(() => {
      result.current.setPreference('dark');
    });

    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    act(() => {
      result.current.setPreference('light');
    });

    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });
  });

  it('should re-apply theme on window focus', async () => {
    jest.useFakeTimers();
    let systemPrefersDark = false;

    mockMatchMedia.mockImplementation((query: string) => ({
      get matches() {
        return query === '(prefers-color-scheme: dark)' && systemPrefersDark;
      },
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));

    // Mock document.hasFocus
    const originalHasFocus = document.hasFocus;
    document.hasFocus = jest.fn().mockReturnValue(true);

    const { result } = renderHook(() => useThemePreference());

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    // Start in light mode
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    // Simulate system change and window focus
    systemPrefersDark = true;
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    // Fast-forward the wake-up timeout (50ms)
    act(() => {
      jest.advanceTimersByTime(50);
    });

    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    // Sub-case: Test when visibilityState is 'hidden' but hasFocus() is true
    systemPrefersDark = false;
    act(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      (document.hasFocus as jest.Mock).mockReturnValue(true);
      window.dispatchEvent(new Event('focus'));
    });

    act(() => {
      jest.advanceTimersByTime(50);
    });

    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    // Restore timers and focus mock
    jest.useRealTimers();
    document.hasFocus = originalHasFocus;
  });

  it('should support legacy addListener/removeListener API', async () => {
    const addListenerMock = jest.fn();
    const removeListenerMock = jest.fn();

    mockMatchMedia.mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: addListenerMock,
      removeListener: removeListenerMock,
      // No addEventListener for this test to trigger the legacy branch
      addEventListener: undefined,
      removeEventListener: undefined,
      dispatchEvent: jest.fn(),
    }));

    const { result, unmount } = renderHook(() => useThemePreference());

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    expect(addListenerMock).toHaveBeenCalled();

    unmount();
    expect(removeListenerMock).toHaveBeenCalled();
  });

  it('should cleanup event listeners when no matchMedia listeners are supported', async () => {
    const addListenerMock = undefined;
    const removeListenerMock = undefined;

    mockMatchMedia.mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: addListenerMock,
      removeListener: removeListenerMock,
      addEventListener: undefined,
      removeEventListener: undefined,
      dispatchEvent: jest.fn(),
    }));

    const spyAddEvent = jest.spyOn(document, 'addEventListener');
    const spyRemoveEvent = jest.spyOn(document, 'removeEventListener');

    const { result } = renderHook(() => useThemePreference());

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    // Should have added and then immediately removed listeners during effect setup
    expect(spyAddEvent).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(spyRemoveEvent).toHaveBeenCalledWith('visibilitychange', expect.any(Function));

    spyAddEvent.mockRestore();
    spyRemoveEvent.mockRestore();
  });
});
