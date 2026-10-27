import { act, renderHook, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { useBookTexts } from '@/components/bible/useBookTexts';

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
  // Every answer waits until the test lets it go, as a slow network does.
  global.fetch = jest.fn((url: string) => {
    calls.push(url);
    return new Promise((resolve) => { release.push(() => resolve(answer(publicFile(url.slice(1))))); });
  }) as unknown as typeof fetch;
});

const letThemGo = () => act(async () => { release.splice(0).forEach((go) => go()); });

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
});
