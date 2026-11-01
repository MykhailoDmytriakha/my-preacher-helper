import {
  arriveOnTrail,
  DEFAULT_TRAIL_PREFS,
  changeTranslationOnTrail,
  leaveOnTrail,
  openedForTranslation,
  readPlaceTrail,
  resetPlaceTrailForTests,
  saveTrailPrefs,
  stepOnTrail,
} from '@/components/bible/placeTrailStore';
import { rememberSearch, resetSearchHistoryForTests } from '@/components/bible/searchHistoryStore';
import { diagnosticEvents } from '@/utils/appDiagnostics';

import type { TrailPlace } from '@/utils/placeTrail';

const at = (book: string, chapter: number, verse = 1): TrailPlace => ({ book, chapter, verse, bible: 'rst' });

beforeEach(() => {
  window.localStorage.clear();
  resetPlaceTrailForTests();
  resetSearchHistoryForTests();
  jest.restoreAllMocks();
});

describe('the trail of places on this device', () => {
  it('is kept on the device: a new page finds the links and the place being read', () => {
    arriveOnTrail(at('Isaiah', 19));
    arriveOnTrail(at('Exodus', 12, 12));
    arriveOnTrail(at('Isaiah', 19));
    resetPlaceTrailForTests();
    const trail = readPlaceTrail();
    expect(trail.links.map((link) => link.book)).toEqual(['Isaiah', 'Exodus']);
    expect(trail.at).toBe(0);
  });

  it('lives for the visit on a device that refuses to store it', () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    arriveOnTrail(at('Isaiah', 19));
    arriveOnTrail(at('Joshua', 2, 11));
    leaveOnTrail(at('Joshua', 2, 15));
    expect(readPlaceTrail().links.map((link) => `${link.book} ${link.chapter}:${link.verse}`)).toEqual(['Isaiah 19:1', 'Joshua 2:11', 'Joshua 2:15']);
  });

  it('another tab lit its place: leaving here adds where this page stopped and leaves the other tab\'s light alone', () => {
    arriveOnTrail(at('Isaiah', 19));
    // Another tab of the app opened Exodus 12:12 meanwhile.
    const other = JSON.stringify({ links: [at('Isaiah', 19), at('Exodus', 12, 12)], at: 1, __savedAt: Date.now() + 1000 });
    window.localStorage.setItem('bible:place-trail', other);
    window.dispatchEvent(new StorageEvent('storage', { key: 'bible:place-trail', newValue: other, storageArea: window.localStorage }));
    expect(readPlaceTrail().at).toBe(1);
    leaveOnTrail(at('Isaiah', 19, 2));
    expect(readPlaceTrail().links.map((link) => `${link.book} ${link.chapter}:${link.verse}`)).toEqual(['Isaiah 19:1', 'Exodus 12:12', 'Isaiah 19:2']);
    expect(readPlaceTrail().at).toBe(1);
  });

  // Codex review r3, 2026-10-27: a word with a clock ran out while a slow load was retried.
  it('a change of translation is taken back by its book\'s next opening, however late, or by any other move first', () => {
    changeTranslationOnTrail('Ruth');
    expect(openedForTranslation('Job')).toBe(false);
    expect(openedForTranslation('Ruth')).toBe(false);
    changeTranslationOnTrail('Ruth');
    const later = jest.spyOn(performance, 'now').mockReturnValue(performance.now() + 60_000);
    expect(openedForTranslation('Ruth')).toBe(true);
    later.mockRestore();
    changeTranslationOnTrail('Ruth');
    arriveOnTrail(at('Isaiah', 19));
    expect(openedForTranslation('Ruth')).toBe(false);
  });

  it('a broken record is an empty trail, and a link that is not a place is dropped', () => {
    window.localStorage.setItem('bible:place-trail', '{not json');
    expect(readPlaceTrail().links).toEqual([]);
    resetPlaceTrailForTests();
    window.localStorage.setItem('bible:place-trail', JSON.stringify({ links: [at('Ruth', 1), { book: 'Ruth', chapter: 0, verse: 1, bible: 'rst' }, { book: 'Job', chapter: 1, verse: 1, bible: 'xx' }], at: 7 }));
    expect(readPlaceTrail()).toEqual({ links: [at('Ruth', 1)], at: 0 });
  });

  it('a shorter history set in the settings takes the oldest links at once and says so in the details', () => {
    ['Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel', '1 Kings', '2 Kings']
      .forEach((book) => arriveOnTrail(at(book, 1)));
    expect(readPlaceTrail().links).toHaveLength(12);
    saveTrailPrefs({ history: 10 }, 'settings');
    expect(readPlaceTrail().links.map((link) => link.book)[0]).toBe('Leviticus');
    expect(readPlaceTrail().links).toHaveLength(10);
    expect(diagnosticEvents().at(-1)?.data).toEqual(expect.objectContaining({ source: 'settings', code: 'placeTrail-history', result: 'ten' }));
  });

  it('numbers the settings do not offer fall back to the defaults', () => {
    window.localStorage.setItem('bible:place-trail-prefs', JSON.stringify({ history: 37, recent: 0, shown: 'yes', verseStart: 1 }));
    saveTrailPrefs({}, 'settings');
    arriveOnTrail(at('Ruth', 1));
    resetPlaceTrailForTests();
    expect(JSON.parse(window.localStorage.getItem('bible:place-trail-prefs') ?? '{}')).toEqual(expect.objectContaining(DEFAULT_TRAIL_PREFS));
  });

  it('the verse start under the places is off at first, kept on the device once switched, and said in the details', () => {
    expect(DEFAULT_TRAIL_PREFS.verseStart).toBe(false);
    saveTrailPrefs({ verseStart: true }, 'reader');
    resetPlaceTrailForTests();
    expect(JSON.parse(window.localStorage.getItem('bible:place-trail-prefs') ?? '{}')).toEqual(expect.objectContaining({ verseStart: true }));
    expect(diagnosticEvents().at(-1)?.data).toEqual(expect.objectContaining({ source: 'reader', code: 'placeTrail-verseStart', result: 'on' }));
  });

  // The owner, 01.11: «Сколько мест хранить» and «Не повторять последние места» went back to the defaults. A page that
  // missed another tab's choice (frozen by Safari, in the background) wrote its older numbers back with its next toggle.
  it('keeps another tab\'s newer numbers when a page that missed them toggles the trail', () => {
    expect(readPlaceTrail().links).toEqual([]);
    saveTrailPrefs({ shown: false }, 'reader');
    // Another tab chose 100 and 10; this page never heard of it.
    window.localStorage.setItem('bible:place-trail-prefs', JSON.stringify({ shown: false, verseStart: false, history: 100, recent: 10, __savedAt: Date.now() + 60_000 }));
    saveTrailPrefs({ shown: true }, 'reader');
    expect(JSON.parse(window.localStorage.getItem('bible:place-trail-prefs') ?? '{}')).toEqual(expect.objectContaining({ shown: true, history: 100, recent: 10 }));
  });

  it('keeps another tab\'s newer places when a page that missed them adds one', () => {
    arriveOnTrail(at('Isaiah', 19));
    window.localStorage.setItem('bible:place-trail', JSON.stringify({ links: [at('Isaiah', 19), at('Ruth', 1)], at: 1, __savedAt: Date.now() + 60_000 }));
    arriveOnTrail(at('Exodus', 12));
    expect(readPlaceTrail().links.map((link) => link.book)).toEqual(['Isaiah', 'Ruth', 'Exodus']);
  });

  it('says in the technical report whether storage held the trail\'s settings when the page opened', () => {
    readPlaceTrail();
    saveTrailPrefs({ shown: true }, 'reader');
    expect(diagnosticEvents().map((event) => event.data)).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'read', code: 'placeTrail', result: 'none' })]));
  });

  /** Another tab's trail, newer than this page's, written while this page heard nothing. */
  const otherTabTrail = (books: string[], lit: number) =>
    window.localStorage.setItem('bible:place-trail', JSON.stringify({ links: books.map((book) => at(book, 1)), at: lit, __savedAt: Date.now() + 60_000 }));

  it('keeps another tab\'s newer places when a page that missed them leaves a verse', () => {
    arriveOnTrail(at('Isaiah', 1));
    otherTabTrail(['Isaiah', 'Ruth'], 1);
    leaveOnTrail(at('Exodus', 1));
    expect(readPlaceTrail().links.map((link) => link.book)).toEqual(['Isaiah', 'Ruth', 'Exodus']);
  });

  it('trims the newest trail when the number of places to keep is lowered', () => {
    arriveOnTrail(at('Isaiah', 1));
    otherTabTrail(['Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel', '1 Kings', '2 Kings'], 11);
    saveTrailPrefs({ history: 10 }, 'settings');
    expect(readPlaceTrail().links.map((link) => link.book)).toEqual(['Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel', '1 Kings', '2 Kings']);
  });

  // Codex review, 01.11: built on the newest trail, the way back's old number lit another place.
  it('steps back onto the place the page showed, found in the newest trail by its place', () => {
    arriveOnTrail(at('Genesis', 1));
    arriveOnTrail(at('Exodus', 1));
    arriveOnTrail(at('Leviticus', 1));
    otherTabTrail(['Ruth', 'Genesis', 'Exodus', 'Leviticus'], 3);
    stepOnTrail(1);
    const trail = readPlaceTrail();
    expect(trail.links[trail.at].book).toBe('Exodus');
  });

  it('keeps another tab\'s newer searches when a page that missed them remembers one', () => {
    rememberSearch('мир', 'rst');
    window.localStorage.setItem('bible:search-history', JSON.stringify({ entries: [{ line: 'любовь', bible: 'rst', at: 2 }, { line: 'мир', bible: 'rst', at: 1 }], __savedAt: Date.now() + 60_000 }));
    rememberSearch('вера', 'rst');
    expect((JSON.parse(window.localStorage.getItem('bible:search-history') ?? '{}').entries as { line: string }[]).map((entry) => entry.line)).toEqual(['вера', 'любовь', 'мир']);
  });
});

