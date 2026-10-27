import {
  arriveOnTrail,
  DEFAULT_TRAIL_PREFS,
  changeTranslationOnTrail,
  leaveOnTrail,
  openedForTranslation,
  readPlaceTrail,
  resetPlaceTrailForTests,
  saveTrailPrefs,
} from '@/components/bible/placeTrailStore';
import { diagnosticEvents } from '@/utils/appDiagnostics';

import type { TrailPlace } from '@/utils/placeTrail';

const at = (book: string, chapter: number, verse = 1): TrailPlace => ({ book, chapter, verse, bible: 'rst' });

beforeEach(() => {
  window.localStorage.clear();
  resetPlaceTrailForTests();
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
});
