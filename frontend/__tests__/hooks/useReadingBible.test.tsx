import { act, renderHook } from '@testing-library/react';

import { useReadingBible } from '@/components/bible/useReadingBible';

let mockLanguage = 'en';
let mockUid: string | undefined = 'reader';
let mockAuthLoading = false;
let mockLoading = true;
let mockOnline = true;
let mockSettings: { language: string } | null = null;
let mockError: Error | null = null;

jest.mock('@/hooks/useResolvedUid', () => ({
  useResolvedUid: () => ({ uid: mockUid, isAuthLoading: mockAuthLoading }),
}));
jest.mock('@/hooks/useUserSettings', () => ({
  ...jest.requireActual('@/hooks/useUserSettings'),
  useUserSettingsQuery: () => ({ data: mockSettings, isLoading: mockLoading, error: mockError, isOnline: mockOnline }),
}));
jest.mock('@locales/useTranslation', () => ({ useTranslation: () => ({ language: mockLanguage }) }));

beforeEach(() => {
  mockLanguage = 'en';
  mockUid = 'reader';
  mockAuthLoading = false;
  mockLoading = true;
  mockOnline = true;
  mockSettings = null;
  mockError = null;
  window.localStorage.clear();
  document.cookie = 'lang=; Max-Age=0; path=/';
});

describe('initial reading Bible readiness', () => {
  it('waits for the current profile instead of interpreting a link through an older language cookie', () => {
    document.cookie = 'lang=en; path=/';
    const view = renderHook(() => useReadingBible(true));
    expect(view.result.current.bible).toBeNull();
    mockSettings = { language: 'ru' };
    mockLoading = false;
    view.rerender();
    expect(view.result.current.bible).toBe('rst');
  });

  it('uses a known profile before language publication without replaying the old default on another render', () => {
    const view = renderHook(() => useReadingBible(true));
    expect(view.result.current.bible).toBeNull();
    mockSettings = { language: 'ru' };
    mockLoading = false;
    view.rerender();
    expect(view.result.current.bible).toBe('rst');
    view.rerender();
    expect(view.result.current.bible).toBe('rst');
    mockLanguage = 'ru';
    view.rerender();
    expect(view.result.current.bible).toBe('rst');
    mockLanguage = 'en';
    view.rerender();
    expect(view.result.current.bible).toBe('kjv');
  });

  it('keeps a stored personal Bible while the profile is pending or changes', () => {
    window.localStorage.setItem('bible:translation', 'kjv');
    const view = renderHook(() => useReadingBible(true));
    expect(view.result.current.bible).toBe('kjv');
    mockLanguage = 'ru';
    mockSettings = { language: 'ru' };
    view.rerender();
    expect(view.result.current.bible).toBe('kjv');
  });

  it('keeps a manual choice when storage refuses and a late profile arrives', () => {
    const view = renderHook(() => useReadingBible(true));
    const denied = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage refused'); });
    try {
      act(() => view.result.current.changeBible('ubio'));
      mockLanguage = 'ru';
      mockSettings = { language: 'ru' };
      mockLoading = false;
      view.rerender();
      expect(view.result.current.bible).toBe('ubio');
    } finally { denied.mockRestore(); }
  });

  it('uses a known device language offline and follows later interface changes', () => {
    mockOnline = false;
    document.cookie = 'lang=ru; path=/';
    const view = renderHook(() => useReadingBible(true));
    expect(view.result.current.bible).toBe('rst');
    mockLanguage = 'ru';
    view.rerender();
    expect(view.result.current.bible).toBe('rst');
    mockLanguage = 'en';
    view.rerender();
    expect(view.result.current.bible).toBe('kjv');
  });

  it.each(['missing', 'failed', 'invalid'])('terminates initialization for a %s profile', mode => {
    mockLoading = mode === 'failed';
    mockError = mode === 'failed' ? new Error('Read failed') : null;
    mockSettings = mode === 'invalid' ? { language: 'unsupported' } : null;
    const view = renderHook(() => useReadingBible(true));
    expect(view.result.current.bible).toBe('kjv');
    mockLanguage = 'ru';
    mockSettings = { language: 'ru' };
    mockLoading = false;
    mockError = null;
    view.rerender();
    expect(view.result.current.bible).toBe('rst');
  });

  it('waits for authentication but does not wait for an absent owner profile', () => {
    mockUid = undefined;
    mockAuthLoading = true;
    const view = renderHook(() => useReadingBible(true));
    expect(view.result.current.bible).toBeNull();
    mockAuthLoading = false;
    view.rerender();
    expect(view.result.current.bible).toBe('kjv');
  });

  it('does not mistake invalid stored values for a personal choice', () => {
    window.localStorage.setItem('bible:translation', 'unsupported');
    document.cookie = 'lang=unsupported; path=/';
    const view = renderHook(() => useReadingBible(true));
    expect(view.result.current.bible).toBeNull();
    mockLoading = false;
    view.rerender();
    expect(view.result.current.bible).toBe('kjv');
  });

  it('can choose from a known profile when device storage cannot be read', () => {
    mockSettings = { language: 'ru' };
    const denied = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage refused'); });
    try {
      const view = renderHook(() => useReadingBible(true));
      expect(view.result.current.bible).toBe('rst');
    } finally { denied.mockRestore(); }
  });

  it('keeps explicitly numbered arrivals available before the profile', () => {
    const view = renderHook(() => useReadingBible(false));
    expect(view.result.current.bible).toBe('kjv');
    mockSettings = { language: 'ru' };
    mockLoading = false;
    view.rerender();
    expect(view.result.current.bible).toBe('kjv');
    mockLanguage = 'ru';
    view.rerender();
    expect(view.result.current.bible).toBe('rst');
  });
});


describe('an explicit marks recovery arrival', () => {
  it('opens the requested reading Bible before another stored choice or a pending profile', () => {
    window.localStorage.setItem('bible:translation', 'kjv');
    const view = renderHook(() => useReadingBible(false, 'rst'));
    expect(view.result.current.bible).toBe('rst');
  });

  it('handles another recovery arrival on the same page while respecting a later picker choice', () => {
    let requested: 'rst' | 'ubio' = 'rst';
    const view = renderHook(() => useReadingBible(false, requested));
    act(() => view.result.current.changeBible('kjv'));
    view.rerender();
    expect(view.result.current.bible).toBe('kjv');
    requested = 'ubio';
    view.rerender();
    expect(view.result.current.bible).toBe('ubio');
  });
});


it('can follow the same recovery translation again after the earlier arrival was consumed', () => {
  let requested: 'rst' | undefined = 'rst';
  const view = renderHook(() => useReadingBible(false, requested));
  requested = undefined;
  act(() => view.result.current.changeBible('kjv'));
  view.rerender();
  expect(view.result.current.bible).toBe('kjv');
  requested = 'rst';
  view.rerender();
  expect(view.result.current.bible).toBe('rst');
});


describe("a visit to an analysis's own Bible", () => {
  it('keeps the device choice while visiting, then persists a deliberate picker choice', () => {
    window.localStorage.setItem('bible:translation', 'kjv');
    const view = renderHook(() => useReadingBible(false, 'rst', { persistRequested: false }));
    expect(view.result.current.bible).toBe('rst');
    expect(window.localStorage.getItem('bible:translation')).toBe('kjv');
    act(() => view.result.current.changeBible('ubio'));
    view.rerender();
    expect(view.result.current.bible).toBe('ubio');
    expect(window.localStorage.getItem('bible:translation')).toBe('ubio');
  });

  it('honors an explicit persistent arrival even when the previous visit requested the same Bible', () => {
    window.localStorage.setItem('bible:translation', 'kjv');
    let persistRequested = false;
    const view = renderHook(() => useReadingBible(false, 'rst', { persistRequested }));
    expect(window.localStorage.getItem('bible:translation')).toBe('kjv');
    persistRequested = true;
    view.rerender();
    expect(view.result.current.bible).toBe('rst');
    expect(window.localStorage.getItem('bible:translation')).toBe('rst');
  });
});
