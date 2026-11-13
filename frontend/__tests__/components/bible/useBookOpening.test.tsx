import { act, configure, renderHook, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { useBookOpening } from '@/components/bible/useBookOpening';
import { __resetConnectivityForTests, reportServerReachable, reportServerUnreachable } from '@/utils/connectivity';

/*
 * The text of the book being read, on the real file of Ruth. BUG-20261112-link-texts-stay-dots-after-reconnect,
 * the same illness in the reader: a book opened without a network said "could not open" and stayed so after the
 * network came back, until the person pressed "Retry". It is read again when the server is back in reach —
 * and a book that has opened is never read again behind the person's back.
 */
const publicFile = (path: string) => JSON.parse(readFileSync(join(__dirname, '../../../public', path), 'utf8'));
const answer = (body: unknown) => ({ ok: true, status: 200, json: async () => body, clone() { return this; }, headers: new Headers({ 'content-type': 'application/json' }) });
const RST_RUTH = '/bible-text/rst/v1/ruth.json';

let calls: string[] = [];
let down = false;

beforeEach(() => {
  calls = [];
  down = false;
  __resetConnectivityForTests();
  showPage(true);
  global.fetch = jest.fn((url: string) => {
    calls.push(url);
    return down ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve(answer(publicFile(url.slice(1))));
  }) as unknown as typeof fetch;
});

/** The page in sight or behind another tab, as the browser tells it. */
function showPage(visible: boolean) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (visible ? 'visible' : 'hidden') });
  document.dispatchEvent(new Event('visibilitychange'));
}

const settled = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

/** The hook with every status it has shown, in order. */
const openRuth = () => {
  const seen: string[] = [];
  const view = renderHook(({ attempt }) => {
    const opening = useBookOpening('Ruth', 'rst', attempt);
    seen.push(opening.status);
    return opening;
  }, { initialProps: { attempt: 0 } });
  return { ...view, seen };
};

describe('useBookOpening', () => {
  it('opens a book the network did not give by itself when the server answers again', async () => {
    down = true;
    const { result } = openRuth();
    await waitFor(() => expect(result.current.status).toBe('error'));
    act(() => reportServerUnreachable());
    await settled();
    expect(calls).toEqual([RST_RUTH]);

    down = false;
    act(() => reportServerReachable());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.text?.chapters).toHaveLength(4);
    expect(calls).toEqual([RST_RUTH, RST_RUTH]);
  });

  it('opens it by itself when the person comes back to the page', async () => {
    down = true;
    const { result } = openRuth();
    await waitFor(() => expect(result.current.status).toBe('error'));
    act(() => showPage(false));

    down = false;
    act(() => showPage(true));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(calls).toEqual([RST_RUTH, RST_RUTH]);
  });

  // Codex review, 2026-11-12: a request that died after the server's return was read again although the page had
  // gone behind another tab, or the server out of reach, in the meantime.
  it.each([
    ['the page has gone behind another tab', () => showPage(false), () => showPage(true)],
    ['the server is out of reach again', () => reportServerUnreachable(), () => reportServerReachable()],
  ])('waits for the next return when its request dies after the server came back and %s', async (_what, leave, comeBack) => {
    const hung: Array<() => void> = [];
    global.fetch = jest.fn((url: string) => {
      calls.push(url);
      if (calls.length > 1) return Promise.resolve(answer(publicFile(url.slice(1))));
      return new Promise((_, reject) => { hung.push(() => reject(new TypeError('Failed to fetch'))); });
    }) as unknown as typeof fetch;
    const { result } = openRuth();
    await waitFor(() => expect(calls).toEqual([RST_RUTH]));
    act(() => reportServerUnreachable());
    act(() => reportServerReachable());
    act(() => leave());
    await act(async () => { hung.splice(0).forEach((fail) => fail()); });
    await settled();
    expect(result.current.status).toBe('error');
    expect(calls).toEqual([RST_RUTH]);

    act(() => comeBack());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(calls).toEqual([RST_RUTH, RST_RUTH]);
  });

  // Codex review, round 2, 2026-11-12: a return of the server that was lost again before the screen acted on it
  // still began the read — out of reach.
  it.each([
    ['the page goes behind another tab', () => showPage(false), () => showPage(true)],
    ['the server goes out of reach again', () => reportServerUnreachable(), () => reportServerReachable()],
  ])('does not read when the server comes back and at once %s — and does at the next return', async (_what, leave, comeBack) => {
    down = true;
    const { result } = openRuth();
    await waitFor(() => expect(result.current.status).toBe('error'));
    act(() => { reportServerUnreachable(); reportServerReachable(); leave(); });
    await settled();
    expect(calls).toEqual([RST_RUTH]);
    expect(result.current.status).toBe('error');

    down = false;
    act(() => comeBack());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(calls).toEqual([RST_RUTH, RST_RUTH]);
  });

  it('reads on "Retry" whatever the server: the person asked, and the device may hold the book', async () => {
    down = true;
    const { result, rerender } = openRuth();
    await waitFor(() => expect(result.current.status).toBe('error'));
    act(() => reportServerUnreachable());
    await settled();

    down = false;
    rerender({ attempt: 1 });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(calls).toEqual([RST_RUTH, RST_RUTH]);
  });

  it('opens in Strict Mode with the server out of reach: the pass React repeats is not taken for a return of the server', async () => {
    configure({ reactStrictMode: true });
    try {
      reportServerUnreachable();
      const { result } = openRuth();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.text?.chapters).toHaveLength(4);
    } finally {
      configure({ reactStrictMode: false });
    }
  });

  it('never reads an opened book again: not when the server comes back, not when the person returns to the page', async () => {
    const { result, seen } = openRuth();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const shown = seen.length;
    act(() => reportServerUnreachable());
    act(() => reportServerReachable());
    act(() => showPage(false));
    act(() => showPage(true));
    await settled();
    expect(calls).toEqual([RST_RUTH]);
    expect(seen.slice(shown).every((status) => status === 'ready')).toBe(true);
  });

  it('does not read again a book that "Retry" has already brought, when the server comes back later', async () => {
    down = true;
    const { result, rerender, seen } = openRuth();
    await waitFor(() => expect(result.current.status).toBe('error'));
    down = false;
    rerender({ attempt: 1 });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const shown = seen.length;

    act(() => reportServerUnreachable());
    act(() => reportServerReachable());
    await settled();
    expect(calls).toEqual([RST_RUTH, RST_RUTH]);
    expect(seen.slice(shown).every((status) => status === 'ready')).toBe(true);
  });
});
