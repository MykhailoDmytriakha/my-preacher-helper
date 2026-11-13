import { act, renderHook, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { useBookTexts } from '@/components/bible/useBookTexts';
import { __resetConnectivityForTests, reportServerReachable, reportServerUnreachable } from '@/utils/connectivity';

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
  calls = [];
  release = [];
  __resetConnectivityForTests();
  showPage(true);
  // Every answer waits until the test lets it go, as a slow network does.
  global.fetch = jest.fn((url: string) => {
    calls.push(url);
    return new Promise((resolve) => { release.push(() => resolve(answer(publicFile(url.slice(1))))); });
  }) as unknown as typeof fetch;
});

const letThemGo = () => act(async () => { release.splice(0).forEach((go) => go()); });

/** How a file the network did not give reaches the page: a network error, or the answer the service worker makes of it. */
const networkError = () => Promise.reject(new TypeError('Failed to fetch'));
const workerRefusal = () => Promise.resolve({ ok: false, status: 503, json: async () => null, clone() { return this; }, headers: new Headers() });

/** A network that gives nothing until the test brings it back. */
const networkDown = (refuse: () => Promise<unknown> = networkError) => {
  let down = true;
  global.fetch = jest.fn((url: string) => {
    calls.push(url);
    return down ? refuse() : Promise.resolve(answer(publicFile(url.slice(1))));
  }) as unknown as typeof fetch;
  return { back: () => { down = false; } };
};

const askedFor = (url: string) => calls.filter((call) => call === url).length;

/** The page in sight or behind another tab, as the browser tells it. */
function showPage(visible: boolean) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (visible ? 'visible' : 'hidden') });
  document.dispatchEvent(new Event('visibilitychange'));
}

/** The failed request has been told to every waiter and forgotten. */
const settled = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

describe('useBookTexts', () => {
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

  /*
   * BUG-20261112-link-texts-stay-dots-after-reconnect: a verse's links opened without a network kept "…"
   * in place of the text after the network came back, until the window was closed and opened again. A book
   * that did not come is asked for again when the app can next ask the server — its one answer to "is
   * there a connection" turns to yes (`utils/connectivity`) with the page in sight, or the person comes
   * back to the page — and never otherwise: no asking in a circle, nothing asked for a book that is here.
   */
  describe('a book the network did not give', () => {
    it.each([
      ['a network error', networkError],
      ['the 503 the service worker answers in production', workerRefusal],
    ])('refused by %s, is asked for again when the server answers again, and its text is shown', async (_how, refuse) => {
      const network = networkDown(refuse);
      const { result } = renderHook(() => useBookTexts(['Ruth', 'Esther'], 'rst'));
      await waitFor(() => expect([...calls].sort()).toEqual([RST_ESTHER, RST_RUTH]));
      act(() => reportServerUnreachable());
      await settled();
      expect(result.current.size).toBe(0);

      network.back();
      act(() => reportServerReachable());
      await waitFor(() => expect(result.current.get('Ruth')?.chapters).toHaveLength(4));
      await waitFor(() => expect(result.current.get('Esther')?.chapters[0][0]).toBe(firstVerse(RST_ESTHER)));
      // One new request a book for one return of the server.
      expect(askedFor(RST_RUTH)).toBe(2);
      expect(askedFor(RST_ESTHER)).toBe(2);
    });

    it('is asked for again when the person comes back to the page: a request killed while the phone slept leaves no other sign', async () => {
      const network = networkDown();
      const { result } = renderHook(() => useBookTexts(['Ruth'], 'rst'));
      await waitFor(() => expect(calls).toEqual([RST_RUTH]));
      await settled();
      act(() => showPage(false));

      network.back();
      act(() => showPage(true));
      await waitFor(() => expect(result.current.get('Ruth')?.chapters).toHaveLength(4));
      expect(askedFor(RST_RUTH)).toBe(2);
    });

    it('still on its way when the server comes back, is waited for — and asked for again at once when that request then dies', async () => {
      // A request that hangs until the test fails it, as one on a dead connection does.
      const hung: Array<() => void> = [];
      let down = true;
      global.fetch = jest.fn((url: string) => {
        calls.push(url);
        if (!down) return Promise.resolve(answer(publicFile(url.slice(1))));
        return new Promise((_, reject) => { hung.push(() => reject(new TypeError('Failed to fetch'))); });
      }) as unknown as typeof fetch;
      const { result } = renderHook(() => useBookTexts(['Ruth'], 'rst'));
      await waitFor(() => expect(calls).toEqual([RST_RUTH]));
      act(() => reportServerUnreachable());
      act(() => reportServerReachable());
      await settled();
      // On its way: waited for, not fetched a second time.
      expect(askedFor(RST_RUTH)).toBe(1);

      down = false;
      await act(async () => { hung.splice(0).forEach((fail) => fail()); });
      await waitFor(() => expect(result.current.get('Ruth')?.chapters).toHaveLength(4));
      expect(askedFor(RST_RUTH)).toBe(2);
    });

    /** Every first request hangs until the test fails it by its address; every later one is refused at once. */
    const hangThenRefuse = () => {
      const hung = new Map<string, () => void>();
      global.fetch = jest.fn((url: string) => {
        calls.push(url);
        if (hung.has(url)) return Promise.reject(new TypeError('Failed to fetch'));
        return new Promise((_, reject) => { hung.set(url, () => reject(new TypeError('Failed to fetch'))); });
      }) as unknown as typeof fetch;
      const fail = (url: string) => act(async () => { hung.get(url)?.(); });
      return Object.assign(fail, { now: (url: string) => hung.get(url)?.() });
    };

    // Codex review, 2026-11-12: two requests that died one after another made the first book's third request.
    it('is asked for once for one return of the server though several books die one after another', async () => {
      const fail = hangThenRefuse();
      renderHook(() => useBookTexts(['Ruth', 'Esther'], 'rst'));
      await waitFor(() => expect(calls).toHaveLength(2));
      act(() => reportServerUnreachable());
      act(() => reportServerReachable());
      await fail(RST_RUTH);
      await settled();
      expect(askedFor(RST_RUTH)).toBe(2);
      await fail(RST_ESTHER);
      await settled();
      await settled();
      expect(askedFor(RST_RUTH)).toBe(2);
      expect(askedFor(RST_ESTHER)).toBe(2);
    });

    // Codex review, 2026-11-12: a request that died after the server's return was asked for again although the
    // page had gone behind another tab, or the server out of reach, in the meantime.
    it.each([
      ['the page has gone behind another tab', () => showPage(false), () => showPage(true)],
      ['the server is out of reach again', () => reportServerUnreachable(), () => reportServerReachable()],
    ])('dying after the server came back, waits for the next return when %s', async (_what, leave, comeBack) => {
      const fail = hangThenRefuse();
      renderHook(() => useBookTexts(['Ruth'], 'rst'));
      await waitFor(() => expect(calls).toHaveLength(1));
      act(() => reportServerUnreachable());
      act(() => reportServerReachable());
      act(() => leave());
      await fail(RST_RUTH);
      await settled();
      expect(askedFor(RST_RUTH)).toBe(1);

      act(() => comeBack());
      await waitFor(() => expect(askedFor(RST_RUTH)).toBe(2));
    });

    // Codex review, round 2, 2026-11-12: a return of the server that was lost again before the screen acted on it
    // still began the read — out of reach.
    it.each([
      ['the page goes behind another tab', () => showPage(false), () => showPage(true)],
      ['the server goes out of reach again', () => reportServerUnreachable(), () => reportServerReachable()],
    ])('is not asked for when the server comes back and at once %s — and is at the next return', async (_what, leave, comeBack) => {
      const network = networkDown();
      const { result } = renderHook(() => useBookTexts(['Ruth'], 'rst'));
      await waitFor(() => expect(calls).toEqual([RST_RUTH]));
      await settled();
      act(() => { reportServerUnreachable(); reportServerReachable(); leave(); });
      await settled();
      expect(askedFor(RST_RUTH)).toBe(1);

      network.back();
      act(() => comeBack());
      await waitFor(() => expect(result.current.get('Ruth')?.chapters).toHaveLength(4));
      expect(askedFor(RST_RUTH)).toBe(2);
    });

    it('is not asked for when its request dies after the server came back and the server is lost before the screen acts', async () => {
      const fail = hangThenRefuse();
      renderHook(() => useBookTexts(['Ruth'], 'rst'));
      await waitFor(() => expect(calls).toHaveLength(1));
      act(() => reportServerUnreachable());
      act(() => reportServerReachable());
      await act(async () => {
        fail.now(RST_RUTH);
        // The refusal reaches the screen through the loader's own steps; the server is lost right after it does.
        for (let step = 0; step < 30; step += 1) await Promise.resolve();
        reportServerUnreachable();
      });
      await settled();
      expect(askedFor(RST_RUTH)).toBe(1);
    });

    // Codex review, round 3, 2026-11-12: the late death of a request nobody wants any more was kept as a read that
    // waits, and the list was drawn again at every return of the person, for nothing.
    it.each([
      ['has left the list', { books: [] as string[], bible: 'rst' as BibleId }],
      ['belongs to the translation left', { books: ['Ruth'], bible: 'kjv' as BibleId }],
    ])('wakes nothing when its request dies after the book %s', async (_what, next) => {
      const fail = hangThenRefuse();
      let draws = 0;
      const { rerender } = renderHook(({ books, bible }) => { draws += 1; return useBookTexts(books, bible); }, { initialProps: { books: ['Ruth'], bible: 'rst' as BibleId } });
      await waitFor(() => expect(calls).toHaveLength(1));
      rerender(next);
      await settled();
      const asked = calls.length;
      await fail(RST_RUTH);
      await settled();
      const drawn = draws;
      for (let visit = 0; visit < 3; visit += 1) {
        act(() => showPage(false));
        act(() => showPage(true));
      }
      await settled();
      expect(draws).toBe(drawn);
      expect(calls).toHaveLength(asked);
    });

    it('is asked for again by a list the person changes, without waiting for the server', async () => {
      const network = networkDown();
      const { result, rerender } = renderHook(({ books }) => useBookTexts(books, 'rst'), { initialProps: { books: ['Ruth'] } });
      await waitFor(() => expect(calls).toEqual([RST_RUTH]));
      await settled();

      network.back();
      rerender({ books: ['Ruth', 'Esther'] });
      await waitFor(() => expect(result.current.get('Ruth')?.chapters).toHaveLength(4));
      expect(askedFor(RST_RUTH)).toBe(2);
    });

    it('is not asked for while the server stays out of reach or the page is behind another tab', async () => {
      jest.useFakeTimers();
      try {
        networkDown();
        renderHook(() => useBookTexts(['Ruth'], 'rst'));
        await act(async () => { await jest.advanceTimersByTimeAsync(0); });
        expect(calls).toEqual([RST_RUTH]);
        act(() => reportServerUnreachable());
        await act(async () => { await jest.advanceTimersByTimeAsync(10 * 60_000); });
        // The server answers while the page is hidden: the book waits for the person's return.
        act(() => showPage(false));
        act(() => reportServerReachable());
        await act(async () => { await jest.advanceTimersByTimeAsync(60_000); });
        expect(calls).toEqual([RST_RUTH]);
      } finally {
        jest.useRealTimers();
      }
    });

    it('is asked for once for one return of the server, however long it keeps failing', async () => {
      networkDown();
      renderHook(() => useBookTexts(['Ruth'], 'rst'));
      await waitFor(() => expect(calls).toEqual([RST_RUTH]));
      act(() => reportServerUnreachable());
      await settled();
      act(() => reportServerReachable());
      await waitFor(() => expect(askedFor(RST_RUTH)).toBe(2));
      await settled();
      await settled();
      expect(askedFor(RST_RUTH)).toBe(2);
    });
  });

  it('asks for nothing again when the server answers again and every book is here', async () => {
    const { result } = renderHook(() => useBookTexts(['Ruth'], 'rst'));
    await waitFor(() => expect(calls).toEqual([RST_RUTH]));
    await letThemGo();
    await waitFor(() => expect(result.current.get('Ruth')?.chapters).toHaveLength(4));
    act(() => reportServerUnreachable());
    act(() => reportServerReachable());
    act(() => showPage(false));
    act(() => showPage(true));
    await settled();
    expect(calls).toEqual([RST_RUTH]);
  });
});
