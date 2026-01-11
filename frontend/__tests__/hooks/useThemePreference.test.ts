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
});
