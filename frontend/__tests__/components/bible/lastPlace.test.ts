import {
  currentEntryId, newEntryState, parsePlaceParam, placeInBook, readEntryFrom, readEntryPlace, readLastPlace, saveEntryPlace, saveLastPlace,
} from '@/components/bible/lastPlace';

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/bible');
});

describe('parsePlaceParam and placeInBook', () => {
  it('reads "chapter:verse" and refuses anything else', () => {
    expect(parsePlaceParam('1:18')).toEqual({ chapter: 1, verse: 18 });
    expect(parsePlaceParam('0:1')).toBeNull();
    expect(parsePlaceParam('1:')).toBeNull();
    expect(parsePlaceParam('99999999999999999999:1')).toBeNull();
    expect(parsePlaceParam(null)).toBeNull();
  });

  it('keeps a place only when the book has that verse', () => {
    const chapters = [['a', 'b'], ['c']];
    expect(placeInBook(chapters, { chapter: 1, verse: 2 })).toEqual({ chapter: 1, verse: 2 });
    expect(placeInBook(chapters, { chapter: 2, verse: 2 })).toBeNull();
    expect(placeInBook(chapters, { chapter: 999, verse: 999 })).toBeNull();
    expect(placeInBook(chapters, null)).toBeNull();
  });
});

describe('the place of a history entry', () => {
  it('gives an entry without one an id, keeping what else the state holds, and the same id after that', () => {
    window.history.replaceState({ __NA: true, tree: 'next' }, '');
    const id = currentEntryId();
    expect(window.history.state).toEqual({ __NA: true, tree: 'next', bibleEntry: id });
    expect(currentEntryId()).toBe(id);
  });

  it('remembers where each entry was read, so Back lands there', () => {
    window.history.pushState(newEntryState(), '', '/bible?book=john');
    const first = currentEntryId();
    saveEntryPlace(first, { chapter: 10, verse: 4, bible: 'ubio' });
    window.history.pushState(newEntryState(), '', '/bible?book=john');
    const second = currentEntryId();
    expect(second).not.toBe(first);
    expect(readEntryPlace(second)).toBeNull();
    expect(readEntryPlace(first)).toEqual({ chapter: 10, verse: 4, bible: 'ubio' });
  });

  it('reads an entry kept before there were several Bibles as read in the Synodal', () => {
    window.history.pushState(newEntryState(), '', '/bible?book=psalms');
    window.sessionStorage.setItem(`bible:entry:${currentEntryId()}`, '{"chapter":22,"verse":1}');
    expect(readEntryPlace(currentEntryId())).toEqual({ chapter: 22, verse: 1, bible: 'rst' });
  });

  it('keeps the place in another book an entry was opened from, and none for an entry opened otherwise', () => {
    window.history.pushState(newEntryState({ slug: 'romans', chapter: 5, verse: 9, bible: 'kjv' }), '', '/bible?book=genesis');
    expect(readEntryFrom()).toEqual({ slug: 'romans', chapter: 5, verse: 9, bible: 'kjv' });
    window.history.pushState(newEntryState(), '', '/bible?book=john');
    expect(readEntryFrom()).toBeNull();
  });
});

describe('the last place on this device', () => {
  it('is read back as it was saved, and ignored when it is not a place', () => {
    saveLastPlace({ slug: 'john', chapter: 3, verse: 16, bible: 'kjv' });
    expect(readLastPlace()).toEqual({ slug: 'john', chapter: 3, verse: 16, bible: 'kjv' });
    window.localStorage.setItem('bible:last-place', '{"slug":"john","chapter":0}');
    expect(readLastPlace()).toBeNull();
    // A Bible the app does not have is no place.
    window.localStorage.setItem('bible:last-place', '{"slug":"john","chapter":3,"verse":16,"bible":"vulgate"}');
    expect(readLastPlace()).toBeNull();
  });

  it('reads a place kept before there were several Bibles as a place of the Synodal', () => {
    window.localStorage.setItem('bible:last-place', '{"slug":"psalms","chapter":22,"verse":1}');
    expect(readLastPlace()).toEqual({ slug: 'psalms', chapter: 22, verse: 1, bible: 'rst' });
  });

  it('is not the start of a book: a book opened and left at once leaves the place there was', () => {
    saveLastPlace({ slug: 'mark', chapter: 2, verse: 1, bible: 'rst' });
    saveLastPlace({ slug: 'genesis', chapter: 1, verse: 1, bible: 'rst' });
    expect(readLastPlace()).toEqual({ slug: 'mark', chapter: 2, verse: 1, bible: 'rst' });
    // A start written before this rule is not offered either.
    window.localStorage.setItem('bible:last-place', '{"slug":"genesis","chapter":1,"verse":1}');
    expect(readLastPlace()).toBeNull();
  });
});
