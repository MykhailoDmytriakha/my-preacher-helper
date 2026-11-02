import { act, render, renderHook } from '@testing-library/react';

import { resetPlaceTrailForTests, saveTrailPrefs, useTrailPrefs, useTrailPrefsWritable } from '@/components/bible/placeTrailStore';
import { UserSettingsEngineContext } from '@/hooks/userSettingsEngineContext';
import { ReadingSettingsSync } from '@/providers/UserSettingsProvider';
import { MOVE_UP_AFTER_MS, resetAccountChoicesForTests } from '@/utils/accountChoice';

let storageSilent = false;
jest.mock('@/utils/deviceStorage', () => ({ ...jest.requireActual('@/utils/deviceStorage'), isStorageSilent: () => storageSilent }));

import type { useDataDocument } from '@/data-engine/react.client';
import type { DocumentData } from '@/data-engine/types';

/*
 * THE READER'S SETTINGS IN THE ACCOUNT (the owner, 2026-11-02): the settings editor carries the trail's numbers to the
 * account, and another device's numbers from it to the screen — through the one settings document, not a new channel.
 * `stored` is the editor's newest copy: what a commit's updater is given, which may be newer than the copy drawn.
 */
type Doc = ReturnType<typeof useDataDocument>;
let stored: DocumentData;
// `freshness` — what the settings copy rests on in this visit: the server's answer, or a copy kept on the device.
const documentOf = (data: DocumentData, { freshness = 'server', writable = true, durable = true, remote = null }: {
  freshness?: 'unknown' | 'cache' | 'server'; writable?: boolean; durable?: boolean; remote?: DocumentData | null;
} = {}) => ({
  state: writable ? { durable } : null, readOnly: false, data, confirmed: { value: data }, status: { freshness }, remote: remote ? { value: remote } : null,
  commit: jest.fn(async (updater: (current: DocumentData | null) => DocumentData | null) => { stored = updater(stored) ?? stored; }),
}) as unknown as Doc;
const sync = (document: Doc) => (
  <UserSettingsEngineContext.Provider value={{ owner: 'owner', document }}><ReadingSettingsSync /></UserSettingsEngineContext.Provider>
);
const TRAIL_KEY = 'bible:place-trail-prefs';

beforeEach(() => {
  storageSilent = false;
  jest.useRealTimers();
  window.localStorage.clear();
  resetAccountChoicesForTests();
  resetPlaceTrailForTests();
  stored = { language: 'ru' };
});

describe('the reader\'s settings and the account', () => {
  it('sends the trail\'s numbers to the account through the settings editor', async () => {
    const document = documentOf(stored);
    render(sync(document));
    await act(async () => { saveTrailPrefs({ history: 100, recent: 10 }, 'settings'); });
    expect(document.commit).toHaveBeenCalled();
    expect(stored).toEqual(expect.objectContaining({ language: 'ru', reading: { trail: expect.objectContaining({ history: 100, recent: 10 }) } }));
  });

  it('shows the numbers another device put in the account', () => {
    const view = render(sync(documentOf(stored)));
    const prefs = renderHook(() => useTrailPrefs());
    expect(prefs.result.current.history).toBe(30);
    act(() => { view.rerender(sync(documentOf({ ...stored, reading: { trail: { history: 100, recent: 10, shown: true, verseStart: false } } }))); });
    expect(prefs.result.current).toEqual(expect.objectContaining({ history: 100, recent: 10, shown: true }));
  });

  it('keeps the account\'s other parts when it writes the trail\'s', async () => {
    stored = { language: 'ru', reading: { mine: { show: false, comments: 'badge' } } };
    render(sync(documentOf(stored)));
    await act(async () => { saveTrailPrefs({ history: 50 }, 'settings'); });
    expect(stored.reading).toEqual({ mine: { show: false, comments: 'badge' }, trail: expect.objectContaining({ history: 50 }) });
  });

  // Codex r1: a toggle built on the device's older copy sent its old numbers over the account's newer ones.
  it('changes only the field the person changed, on the account\'s newest numbers', async () => {
    window.localStorage.setItem(TRAIL_KEY, JSON.stringify({ history: 30, recent: 7, __savedAt: 1 }));
    window.localStorage.setItem(`${TRAIL_KEY}:owner`, 'owner');
    stored = { language: 'ru', reading: { trail: { history: 100, recent: 10, shown: false, verseStart: false } } };
    render(sync(documentOf({ language: 'ru' })));
    await act(async () => { saveTrailPrefs({ shown: true }, 'reader'); });
    expect(stored.reading).toEqual({ trail: { history: 100, recent: 10, shown: true, verseStart: false } });
  });

  it('sends the device\'s earlier numbers up only after the server has answered', async () => {
    jest.useFakeTimers();
    // A copy kept on the device may not have heard of another device's choice yet: answering it with this device's
    // older numbers would replace that choice.
    window.localStorage.setItem(TRAIL_KEY, JSON.stringify({ history: 100, recent: 10, __savedAt: 1 }));
    const cached = documentOf(stored, { freshness: 'cache' });
    const view = render(sync(cached));
    await act(async () => { jest.advanceTimersByTime(MOVE_UP_AFTER_MS * 2); });
    expect(cached.commit).not.toHaveBeenCalled();
    const answered = documentOf(stored, { freshness: 'server' });
    view.rerender(sync(answered));
    await act(async () => { jest.advanceTimersByTime(MOVE_UP_AFTER_MS); });
    expect(answered.commit).toHaveBeenCalled();
    expect(stored.reading).toEqual({ trail: expect.objectContaining({ history: 100, recent: 10 }) });
  });

  // Codex r1: the server's answer showed before the settings copy took it — the record went up over the account's part.
  it('leaves a part the editor\'s newest copy already holds when the device\'s earlier numbers go up', async () => {
    jest.useFakeTimers();
    window.localStorage.setItem(TRAIL_KEY, JSON.stringify({ history: 100, recent: 10, __savedAt: 1 }));
    stored = { language: 'ru', reading: { trail: { history: 50, recent: 7, shown: false, verseStart: false } } };
    render(sync(documentOf({ language: 'ru' }, { freshness: 'server' })));
    await act(async () => { jest.advanceTimersByTime(MOVE_UP_AFTER_MS); });
    expect(stored.reading).toEqual({ trail: { history: 50, recent: 7, shown: false, verseStart: false } });
  });

  it('makes the reader\'s settings unavailable while the settings cannot be written', async () => {
    const document = documentOf(stored, { writable: false });
    render(sync(document));
    const writable = renderHook(() => useTrailPrefsWritable());
    expect(writable.result.current).toBe(false);
    await act(async () => { saveTrailPrefs({ history: 100 }, 'settings'); });
    expect(document.commit).not.toHaveBeenCalled();
    expect(renderHook(() => useTrailPrefs()).result.current.history).toBe(30);
  });

  // Codex r2: storage marked silent left the controls on.
  it('makes them unavailable while the settings\' storage does not keep', () => {
    render(sync(documentOf(stored, { durable: false })));
    expect(renderHook(() => useTrailPrefsWritable()).result.current).toBe(false);
  });

  // Codex r2: while this device's work was on its way, the server's part waited outside the editor, and a toggle or the
  // device's earlier numbers created the part over it — a conflict nobody chose.
  it('waits while the server\'s copy of the part has not reached the editor', async () => {
    jest.useFakeTimers();
    window.localStorage.setItem(TRAIL_KEY, JSON.stringify({ history: 50, recent: 7, __savedAt: 1 }));
    const document = documentOf({ language: 'ru' }, { remote: { language: 'ru', reading: { trail: { history: 100, recent: 10, shown: false, verseStart: false } } } });
    render(sync(document));
    expect(renderHook(() => useTrailPrefsWritable()).result.current).toBe(false);
    await act(async () => { saveTrailPrefs({ shown: true }, 'reader'); jest.advanceTimersByTime(MOVE_UP_AFTER_MS * 2); });
    expect(document.commit).not.toHaveBeenCalled();
  });

  it('waits for the server before creating a part the editor does not hold', () => {
    render(sync(documentOf({ language: 'ru' }, { freshness: 'cache' })));
    expect(renderHook(() => useTrailPrefsWritable()).result.current).toBe(false);
  });

  // Codex r3: another editor's transaction left device storage silent while this one still said it kept — a change then
  // waited behind it.
  it('makes them unavailable while device storage is known silent', () => {
    storageSilent = true;
    render(sync(documentOf(stored)));
    expect(renderHook(() => useTrailPrefsWritable()).result.current).toBe(false);
  });
});
