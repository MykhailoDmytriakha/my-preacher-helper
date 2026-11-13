import { act, render, waitFor } from '@testing-library/react';
import { useSearchParams } from 'next/navigation';

import BiblePage from '@/(pages)/(private)/bible/page';
import { BibleBookReader } from '@/components/bible/BibleBookReader';
import { warmBibleTextOnce } from '@/utils/bibleText';
import { __resetConnectivityForTests, reportServerReachable, reportServerUnreachable } from '@/utils/connectivity';

/*
 * An analysis named in the reader's address — opened from a sermon's prep or its header — is read in the Bible it was made
 * in, not the one this device reads: its parts stand on that Bible's words (Codex, 31.10; BUG-20261030-analysis-other-
 * bible-overwrite). Only for the visit: the device's own Bible is not changed.
 */
jest.mock('@/hooks/useResolvedUid', () => ({ useResolvedUid: () => ({ uid: 'owner', isAuthLoading: false }) }));
jest.mock('@/hooks/useUserSettings', () => ({ ...jest.requireActual('@/hooks/useUserSettings'), useUserSettingsQuery: () => ({ data: null, isLoading: false, error: null, isOnline: true }) }));
jest.mock('next/navigation', () => ({ useSearchParams: jest.fn() }));
jest.mock('@/components/bible/BibleBookReader', () => ({ BibleBookReader: jest.fn(() => null) }));
jest.mock('@/components/bible/BibleBookList', () => ({ BibleBookList: () => null }));
jest.mock('@/utils/bibleText', () => ({ ...jest.requireActual('@/utils/bibleText'), warmBibleTextOnce: jest.fn().mockResolvedValue({ storageFailed: false }) }));

const at = (query: string) => jest.mocked(useSearchParams).mockReturnValue(new URLSearchParams(query) as unknown as ReturnType<typeof useSearchParams>);
const readerBible = () => (jest.mocked(BibleBookReader).mock.calls.at(-1)?.[0] as { bible: string } | undefined)?.bible;

describe('the Bible an analysis opens in', () => {
  beforeEach(() => { jest.clearAllMocks(); localStorage.clear(); localStorage.setItem('bible:translation', 'kjv'); });

  it('opens an analysis named in the address in its own Bible, the device\'s choice kept', async () => {
    at('book=ephesians&at=1:3&to=14&tr=rst&analysis=a1&mode=view');
    render(<BiblePage />);
    await waitFor(() => expect(readerBible()).toBe('rst'));
    expect(localStorage.getItem('bible:translation')).toBe('kjv');
  });

  it('opens a place without an analysis in the Bible this device reads', async () => {
    at('book=ephesians&at=1:3&tr=rst');
    render(<BiblePage />);
    await waitFor(() => expect(readerBible()).toBe('kjv'));
  });
});


it('warms the current Bible after a confirmed server return instead of the earlier browser online event', async () => {
  __resetConnectivityForTests();
  localStorage.setItem('bible:translation', 'kjv');
  at('');
  jest.mocked(warmBibleTextOnce).mockClear();
  const original = Object.getOwnPropertyDescriptor(window, 'requestIdleCallback');
  const idle = jest.fn((_run: () => void) => 1);
  Object.defineProperty(window, 'requestIdleCallback', { configurable: true, value: idle });
  reportServerUnreachable();
  try {
    render(<BiblePage />);
    await waitFor(() => expect(idle).toHaveBeenCalledTimes(1));
    await act(async () => {
      idle.mock.calls.forEach(([run]) => (run as () => void)());
      window.dispatchEvent(new Event('online'));
    });
    expect(warmBibleTextOnce).not.toHaveBeenCalled();
    act(() => reportServerReachable());
    await waitFor(() => expect(warmBibleTextOnce).toHaveBeenCalledTimes(1));
    expect(jest.mocked(warmBibleTextOnce).mock.calls[0]?.[0].bible).toBe('kjv');
  } finally {
    if (original) Object.defineProperty(window, 'requestIdleCallback', original);
    else Reflect.deleteProperty(window, 'requestIdleCallback');
  }
});
