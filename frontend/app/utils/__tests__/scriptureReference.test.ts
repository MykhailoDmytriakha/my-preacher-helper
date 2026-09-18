import {
  formatScriptureReference,
  formatScriptureReferences,
  scriptureReferenceSearchText,
} from '@/utils/scriptureReference';

/**
 * ONE SCRIPTURE REFERENCE, THREE LEGITIMATE FACES — and only three.
 *
 * Eight functions used to turn a stored reference into text, each with its own idea of what a
 * chapter range is, whether "5-5" is a range, and whether Psalm 23 is Psalm 22 in a Russian
 * Bible. The calendar ended up printing "Luke 5:17-26" under a note whose own chips said
 * "Лк.5:17-26". This file is the specification all of them now share.
 */
describe('the short face — chips and compact labels', () => {
  it('abbreviates the book in the interface language', () => {
    expect(formatScriptureReference({ book: 'Luke', chapter: 5, fromVerse: 17, toVerse: 26 }, { locale: 'ru' })).toBe('Лк.5:17-26');
    expect(formatScriptureReference({ book: 'John', chapter: 3, fromVerse: 16 }, { locale: 'uk' })).toBe('Ів.3:16');
    expect(formatScriptureReference({ book: 'Matthew', chapter: 5 }, { locale: 'en' })).toBe('Matt.5');
  });

  it('is the default face', () => {
    expect(formatScriptureReference({ book: 'Luke', chapter: 5 }, { locale: 'ru' })).toBe('Лк.5');
  });
});

describe('the long face — text a person reads', () => {
  it('spells the book out in the interface language', () => {
    expect(formatScriptureReference({ book: 'Luke', chapter: 5, fromVerse: 17, toVerse: 26 }, { locale: 'ru', style: 'long' })).toBe('От Луки 5:17-26');
    expect(formatScriptureReference({ book: 'Luke', chapter: 5 }, { locale: 'en', style: 'long' })).toBe('Luke 5');
    expect(formatScriptureReference({ book: 'John' }, { locale: 'uk', style: 'long' })).toBe('Від Івана');
  });
});

describe('the canonical face — machines and prompts', () => {
  it('keeps the stored English name and the stored numbering', () => {
    expect(formatScriptureReference({ book: 'Luke', chapter: 5, fromVerse: 17, toVerse: 26 }, { locale: 'ru', style: 'canonical' })).toBe('Luke 5:17-26');
    expect(formatScriptureReference({ book: 'Psalms', chapter: 23 }, { locale: 'ru', style: 'canonical' })).toBe('Psalms 23');
  });
});

describe('the Psalms are numbered the way the reader\'s Bible numbers them', () => {
  it('converts to the Septuagint numbering for Russian and Ukrainian', () => {
    expect(formatScriptureReference({ book: 'Psalms', chapter: 23 }, { locale: 'ru' })).toBe('Пс.22');
    expect(formatScriptureReference({ book: 'Psalms', chapter: 23, fromVerse: 1 }, { locale: 'uk', style: 'long' })).toBe('Псалми 22:1');
    expect(formatScriptureReference({ book: 'Psalms', chapter: 23, toChapter: 25 }, { locale: 'ru', style: 'long' })).toBe('Псалтирь 22-24');
  });

  it('leaves the English numbering as stored', () => {
    expect(formatScriptureReference({ book: 'Psalms', chapter: 23 }, { locale: 'en', style: 'long' })).toBe('Psalms 23');
  });
});

describe('the shape of a reference is read one way in every face', () => {
  const styles = ['short', 'long', 'canonical'] as const;

  it.each(styles)('a verse wins over a stale chapter range from old data (%s)', (style) => {
    const text = formatScriptureReference({ book: 'Luke', chapter: 5, toChapter: 6, fromVerse: 17 }, { locale: 'en', style });
    expect(text).toMatch(/5:17$/);
  });

  it.each(styles)('a range that ends where it starts is one verse (%s)', (style) => {
    const text = formatScriptureReference({ book: 'Luke', chapter: 5, fromVerse: 17, toVerse: 17 }, { locale: 'en', style });
    expect(text).toMatch(/5:17$/);
  });

  it.each(styles)('a chapter range that ends where it starts is one chapter (%s)', (style) => {
    const text = formatScriptureReference({ book: 'Luke', chapter: 5, toChapter: 5 }, { locale: 'en', style });
    expect(text).toMatch(/5$/);
    expect(text).not.toMatch(/-/);
  });

  it.each(styles)('a real chapter range stays a range (%s)', (style) => {
    const text = formatScriptureReference({ book: 'Matthew', chapter: 5, toChapter: 7 }, { locale: 'en', style });
    expect(text).toMatch(/5-7$/);
  });

  it.each(['short', 'long', 'canonical'] as const)('never prints an absent part as "undefined" (%s)', (style) => {
    // The old recovery formatter once produced "Matthew undefined:undefined" for a whole-book
    // reference; every part below the book is optional in the model.
    for (const ref of [
      { book: 'Matthew' },
      { book: 'Matthew', chapter: 5 },
      { book: 'Matthew', chapter: 5, toChapter: 7 },
      { book: 'Matthew', chapter: 5, fromVerse: 3 },
    ]) {
      expect(formatScriptureReference(ref, { locale: 'ru', style })).not.toMatch(/undefined|NaN/);
    }
  });

  it('keeps a book it does not know, instead of printing nothing', () => {
    expect(formatScriptureReference({ book: 'Unknown', chapter: 1 }, { locale: 'ru', style: 'long' })).toBe('Unknown 1');
  });
});

describe('a list of references', () => {
  it('joins them with a semicolon', () => {
    expect(formatScriptureReferences([
      { book: 'Luke', chapter: 5, fromVerse: 17 },
      { book: 'John', chapter: 2 },
    ], { locale: 'ru', style: 'long' })).toBe('От Луки 5:17; От Иоанна 2');
  });

  it('says nothing for nothing', () => {
    expect(formatScriptureReferences([], { locale: 'ru' })).toBeUndefined();
    expect(formatScriptureReferences(undefined, { locale: 'ru' })).toBeUndefined();
  });

  it('stops at a limit when asked, for previews', () => {
    expect(formatScriptureReferences([
      { book: 'Luke', chapter: 1 },
      { book: 'Luke', chapter: 2 },
      { book: 'Luke', chapter: 3 },
    ], { locale: 'en', style: 'canonical', limit: 2 })).toBe('Luke 1; Luke 2');
  });
});

describe('what a search may find a reference by', () => {
  it('finds a Psalm by the number the card shows, not the stored one', () => {
    // The studies list searched "Псалтирь 23" while the card said "Псалтирь 22".
    const text = scriptureReferenceSearchText({ book: 'Psalms', chapter: 23 }, 'ru');
    expect(text).toContain('псалтирь 22');
    expect(text).not.toContain('псалтирь 23');
  });

  it('answers to the abbreviation and to the spelled-out name alike', () => {
    const text = scriptureReferenceSearchText({ book: 'John', chapter: 2, fromVerse: 1, toVerse: 11 }, 'ru');
    expect(text).toContain('ин.2:1-11');
    expect(text).toContain('от иоанна 2:1-11');
  });
});
