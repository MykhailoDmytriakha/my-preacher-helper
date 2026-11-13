import { act, renderHook, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { useBookTexts } from '@/components/bible/useBookTexts';
import { BIBLE_ASSET_NETWORK_FAILURE_HEADER } from '@/utils/bibleAssetResponse';
import { __resetConnectivityForTests, getConnectivityStatus, reportServerReachable, reportServerUnreachable } from '@/utils/connectivity';

import type { BibleId } from '@/utils/bibles';

/*
 * The texts of other books a reading screen quotes (the cross references, the trail's verse start), on the
 * real files of Ruth and Esther. Codex review, 2026-10-26: the list of books stays on screen across a change
 * of translation, so a text must not outlive its Bible; and a trail names a book once per place, so a book
 * still on its way must not be fetched again as the trail grows.
 */
const publicFile = (path: string) => JSON.parse(readFileSync(join(__dirname, '../../../public', path), 'utf8'));
const answer = (body: unknown) => ({ ok: true, status: 200, json: async () => body, clone() { return this; }, headers: new Headers({ 'content-type': 'application/json' }) });
const RST_RUTH = '/bible-text/rst/v1/ruth.json';
const KJV_RUTH = '/bible-text/kjv/v1/ruth.json';
const RST_ESTHER = '/bible-text/rst/v1/esther.json';
const firstVerse = (path: string) => publicFile(path.slice(1)).chapters[0][0];

let calls: string[] = [];
let release: Array<() => void> = [];

beforeEach(() => {
  __resetConnectivityForTests();
  calls = [];
  release = [];
  // Every answer waits until the test lets it go, as a slow network does.
  global.fetch = jest.fn((url: string) => {
    calls.push(url);
    return new Promise((resolve) => { release.push(() => resolve(answer(publicFile(url.slice(1))))); });
  }) as unknown as typeof fetch;
});

const letThemGo = () => act(async () => { release.splice(0).forEach((go) => go()); });

describe('useBookTexts', () => {
  it('loads a missing book after confirmed reconnection without refetching the book already shown', async () => {
    reportServerUnreachable();
    let available = false;
    const fetchBook = jest.fn(async (url: string) => {
      if (url === RST_ESTHER && !available) throw new TypeError('offline');
      return answer(publicFile(url.slice(1)));
    });
    global.fetch = fetchBook as unknown as typeof fetch;
    const { result } = renderHook(() => useBookTexts(['Ruth', 'Esther'], 'rst'));
    await waitFor(() => expect(result.current.has('Ruth')).toBe(true));
    expect(result.current.has('Esther')).toBe(false);
    expect(fetchBook.mock.calls.map(([url]) => url)).toEqual([RST_ESTHER, RST_RUTH]);

    available = true;
    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(fetchBook.mock.calls).toHaveLength(2);
    act(() => { reportServerReachable(); });

    await waitFor(() => expect(result.current.get('Esther')?.chapters[0][0]).toBe(firstVerse(RST_ESTHER)));
    expect(fetchBook.mock.calls.map(([url]) => url)).toEqual([RST_ESTHER, RST_RUTH, RST_ESTHER]);
  });

  it.each(['browser', 'service worker'])('recovers on Wi-Fi from a network failure reported by the %s', async source => {
    expect(navigator.onLine).toBe(true);
    const fetchBook = jest.fn();
    if (source === 'browser') fetchBook.mockRejectedValueOnce(new TypeError('unreachable'));
    else fetchBook.mockResolvedValueOnce({ ok: false, status: 503, headers: new Headers({ [BIBLE_ASSET_NETWORK_FAILURE_HEADER]: '1' }) });
    fetchBook.mockResolvedValueOnce(answer(publicFile(RST_RUTH.slice(1))));
    global.fetch = fetchBook as unknown as typeof fetch;
    const { result } = renderHook(() => useBookTexts(['Ruth'], 'rst'));
    await waitFor(() => expect(getConnectivityStatus()).toBe(false));
    expect(navigator.onLine).toBe(true);
    expect(fetchBook).toHaveBeenCalledTimes(1);
    act(() => { reportServerReachable(); });
    await waitFor(() => expect(result.current.get('Ruth')?.chapters[0][0]).toBe(firstVerse(RST_RUTH)));
    expect(fetchBook).toHaveBeenCalledTimes(2);
  });

  it('retries an older request after reconnection even if the list grew while it was pending', async () => {
    reportServerUnreachable();
    let rejectOffline!: (error: Error) => void;
    const offline = new Promise<Response>((_resolve, reject) => { rejectOffline = reject; });
    let ruthCalls = 0;
    const fetchBook = jest.fn(async (url: string) => {
      if (url !== RST_RUTH) return answer(publicFile(url.slice(1)));
      ruthCalls++;
      if (ruthCalls === 1) return offline;
      if (ruthCalls === 2) return { ok: false, status: 503 };
      return answer(publicFile(url.slice(1)));
    });
    global.fetch = fetchBook as unknown as typeof fetch;
    const { result, rerender } = renderHook(({ books }) => useBookTexts(books, 'rst'), { initialProps: { books: ['Ruth'] } });
    await waitFor(() => expect(ruthCalls).toBe(1));
    act(() => { reportServerReachable(); });
    rerender({ books: ['Ruth', 'Esther'] });
    await waitFor(() => expect(result.current.has('Esther')).toBe(true));
    expect(ruthCalls).toBe(1);
    await act(async () => { rejectOffline(new TypeError('offline')); });
    expect(ruthCalls).toBe(2);
    await waitFor(() => expect(result.current.get('Ruth')?.chapters[0][0]).toBe(firstVerse(RST_RUTH)));
    expect(ruthCalls).toBe(3);
  });

  it('limits repeated failures while connected and stops on unmount', async () => {
    jest.useFakeTimers();
    try {
      const fetchBook = jest.fn().mockResolvedValue({ ok: false, status: 503 });
      global.fetch = fetchBook as unknown as typeof fetch;
      const { unmount } = renderHook(() => useBookTexts(['Ruth'], 'rst'));
      await act(async () => { await jest.advanceTimersByTimeAsync(0); });
      expect(fetchBook).toHaveBeenCalledTimes(1);
      await act(async () => { await jest.advanceTimersByTimeAsync(100); });
      act(() => { reportServerUnreachable(); });
      await act(async () => { await jest.advanceTimersByTimeAsync(100); });
      await act(async () => { reportServerReachable(); });
      expect(fetchBook).toHaveBeenCalledTimes(2);
      await act(async () => { await jest.advanceTimersByTimeAsync(2000); });
      expect(fetchBook).toHaveBeenCalledTimes(3);
      await act(async () => { reportServerUnreachable(); reportServerReachable(); });
      expect(fetchBook).toHaveBeenCalledTimes(4);
      unmount();
      await act(async () => { await jest.advanceTimersByTimeAsync(2000); });
      expect(fetchBook).toHaveBeenCalledTimes(4);
    } finally {
      jest.useRealTimers();
    }
  });

  it('fetches a book once while it is on its way, however often and however late the list names it', async () => {
    const { result, rerender } = renderHook(({ books }) => useBookTexts(books, 'rst'), { initialProps: { books: ['Ruth'] } });
    rerender({ books: ['Ruth', 'Ruth'] });
    // The list grows by another book while Ruth is still on its way.
    rerender({ books: ['Ruth', 'Ruth', 'Esther'] });
    await waitFor(() => expect([...calls].sort()).toEqual([RST_ESTHER, RST_RUTH]));
    await letThemGo();
    await waitFor(() => expect(result.current.get('Ruth')?.chapters).toHaveLength(4));
    await waitFor(() => expect(result.current.get('Esther')?.chapters[0][0]).toBe(firstVerse(RST_ESTHER)));
    expect(calls).toHaveLength(2);
  });

  it('keeps the texts of one Bible: another translation shows none of the old one\'s and fetches its own', async () => {
    const { result, rerender } = renderHook(({ bible }: { bible: BibleId }) => useBookTexts(['Ruth'], bible), { initialProps: { bible: 'rst' as BibleId } });
    await waitFor(() => expect(calls).toEqual([RST_RUTH]));
    await letThemGo();
    await waitFor(() => expect(result.current.get('Ruth')?.chapters[0][0]).toBe(firstVerse(RST_RUTH)));

    rerender({ bible: 'kjv' });
    expect(result.current.has('Ruth')).toBe(false);
    await waitFor(() => expect(calls).toEqual([RST_RUTH, KJV_RUTH]));
    await letThemGo();
    await waitFor(() => expect(result.current.get('Ruth')?.chapters[0][0]).toBe(firstVerse(KJV_RUTH)));
  });

  it('drops a book of the Bible left that arrives after the translation changed', async () => {
    const { result, rerender } = renderHook(({ bible }: { bible: BibleId }) => useBookTexts(['Ruth'], bible), { initialProps: { bible: 'rst' as BibleId } });
    await waitFor(() => expect(calls).toEqual([RST_RUTH]));
    rerender({ bible: 'kjv' });
    await waitFor(() => expect(calls).toEqual([RST_RUTH, KJV_RUTH]));
    await letThemGo();
    await waitFor(() => expect(result.current.get('Ruth')).toBeDefined());
    expect(result.current.get('Ruth')?.chapters[0][0]).toBe(firstVerse(KJV_RUTH));
  });
});
