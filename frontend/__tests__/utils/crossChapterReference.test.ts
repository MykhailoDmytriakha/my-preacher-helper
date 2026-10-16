import { bibleHrefForText, leadingReference, namesAPlace, parsePassageEndpoint, referenceFromText, referencesInText } from '@/utils/bibleLink';
import { formatScriptureReference } from '@/utils/scriptureReference';
import { referenceIn, sameScriptureReference, versesHeldIn, withStoredBible } from '@/utils/scriptureReferenceNumbering';
import { parseReferenceText } from '@/utils/scriptureReferenceParser';

// Start with the existing public seams so RED proves wrong behavior, not a missing module.
describe('exact passages across chapter boundaries', () => {
  it.each(['Isaiah 52:13–53:12', 'Genesis 1:1–2:3', 'John 3:16–4:2'])(
    'keeps both endpoints of %s through parsing and display', (raw) => {
      const parsed = parseReferenceText(raw, { locale: 'en' });
      expect(parsed).not.toBeNull();
      expect(formatScriptureReference({ ...parsed!, bible: 'kjv' }, { style: 'canonical' })).toBe(raw.replace('–', '-'));
    }
  );

  it('opens the full passage and detects it whole inside prose', () => {
    const raw = 'Isaiah 52:13-53:12';
    const url = new URL(bibleHrefForText(raw, { locale: 'en' })!, 'https://app.invalid');
    expect(url.searchParams.get('at')).toBe('52:13');
    expect(url.searchParams.get('to')).toBe('53:12');
    expect(referencesInText(`Read ${raw} today.`, 'en').map((ref) => ref.raw)).toEqual([raw]);
    expect(leadingReference(`${raw} — the servant`, { locale: 'en' })?.end).toBe(raw.length);
  });

  it('enumerates each chapter exactly up to the ending verse', () => {
    const ref = referenceFromText('Isaiah 52:13-53:12', 'kjv')!;
    const verses = versesHeldIn(ref, 'kjv');
    expect(verses).toHaveLength(15);
    expect(verses[0]).toEqual({ book: 'Isaiah', chapter: 52, verse: 13 });
    expect(verses.at(-1)).toEqual({ book: 'Isaiah', chapter: 53, verse: 12 });
  });

  it('does not widen a partial cross-chapter translation into whole chapters', () => {
    const source = { bible: 'rst' as const, book: 'Psalms', chapter: 9, fromVerse: 20, toVerse: 25 };
    expect(versesHeldIn(referenceIn(source, 'kjv'), 'kjv')).toEqual(versesHeldIn(source, 'kjv'));
  });

  it('preserves the existing meaning of legacy mixed shapes and ordinary references', () => {
    const legacy = { bible: 'kjv' as const, book: 'Luke', chapter: 5, toChapter: 6, fromVerse: 17, toVerse: 18 };
    expect(formatScriptureReference(legacy, { style: 'canonical' })).toBe('Luke 5:17-18');
    expect(versesHeldIn(legacy, 'kjv')).toHaveLength(2);
    for (const raw of ['John 3:16', 'John 3:16-18', 'Matthew 5-7', 'Genesis 1', 'Romans']) {
      expect(formatScriptureReference({ ...parseReferenceText(raw)!, bible: 'kjv' }, { style: 'canonical' })).toBe(raw);
    }
  });
});

describe('text transformations keep a cross-chapter passage whole', () => {
  it('keeps the ending chapter and verse in prose normalization', () => {
    const { normalizeSpokenScriptureReferences } = require('@/utils/scriptureReferenceNormalizer');
    const result = normalizeSpokenScriptureReferences('Read Isaiah 52:13-53:12 today.');
    expect(leadingReference(result.replace(/^Read /, ''), { locale: 'en' })?.reference).toMatchObject({ chapter: 52, fromVerse: 13, endChapter: 53, toVerse: 12 });
  });

  it('speaks both chapters and the final verse instead of leaving a numeric tail', () => {
    const { normalizeScriptureReferencesForTts } = require('@/utils/scriptureReferenceNormalizer');
    const result = normalizeScriptureReferencesForTts('\u0418\u0441 52:13-53:12');
    expect(result).not.toMatch(/\d/);
    expect(result).toContain('\u043f\u044f\u0442\u044c\u0434\u0435\u0441\u044f\u0442 \u0432\u0442\u043e\u0440\u0430\u044f \u0433\u043b\u0430\u0432\u0430');
    expect(result).toContain('\u043f\u044f\u0442\u044c\u0434\u0435\u0441\u044f\u0442 \u0442\u0440\u0435\u0442\u044c\u044f \u0433\u043b\u0430\u0432\u0430');
    expect(result).toContain('\u0434\u0432\u0435\u043d\u0430\u0434\u0446\u0430\u0442\u044b\u0439 \u0441\u0442\u0438\u0445');
  });
});


describe('endpoint compatibility and invalid ranges', () => {
  it('keeps old numeric URLs and reads new explicit endpoints', () => {
    expect(parsePassageEndpoint('18')).toEqual({ verse: 18 });
    expect(parsePassageEndpoint('53:12')).toEqual({ chapter: 53, verse: 12 });
    for (const value of ['0', '0:12', '53:0', '53:12:4', '9999:1']) expect(parsePassageEndpoint(value)).toBeNull();
  });

  it('distinguishes ending chapters without changing the meaning of a legacy leftover', () => {
    const ref = { bible: 'kjv' as const, book: 'John', chapter: 3, fromVerse: 16, endChapter: 4, toVerse: 2 };
    expect(sameScriptureReference(ref, { ...ref, endChapter: 5 })).toBe(false);
    expect(sameScriptureReference({ ...ref, endChapter: undefined, toVerse: 18, toChapter: 9 }, { ...ref, endChapter: undefined, toVerse: 18 })).toBe(true);
  });

  it('rejects reversed explicit passages and does not walk an unbounded or nonexistent endpoint', () => {
    for (const raw of ['John 4:2-3:16', 'John 3:16-3:2']) expect(parseReferenceText(raw)).toBeNull();
    const ref = { bible: 'kjv' as const, book: 'John', chapter: 3, fromVerse: 16, endChapter: 9999999999, toVerse: 2 };
    expect(versesHeldIn(ref, 'kjv')).toEqual([]);
    expect(namesAPlace(ref)).toBe(false);
    expect(namesAPlace({ ...ref, endChapter: 4, toVerse: 999 })).toBe(false);
  });
});


describe('reviewed endpoint edges', () => {
  it.each(['John 3:16-4:', 'John 3:16 - 4:', 'John 3:16-4:x', 'John 3:16-4:2:3', 'Isaiah 52:13-53:', 'John 3:16-:20', 'John 3:16 - :20', 'John 3:-4:20', 'John 3-4:20', 'John 3:16--4:20', 'Ezeki 3:16-:20'])(
    'rejects an unfinished or malformed explicit endpoint in %s', (raw) => {
      expect(parseReferenceText(raw, { locale: 'en' })).toBeNull();
      expect(referenceFromText(raw, 'kjv')).toBeNull();
      expect(referencesInText(raw, 'en')).toEqual([]);
      expect(leadingReference(raw, { locale: 'en' })).toBeNull();
    }
  );

  it('applies the established Bible-less Psalm convention to both explicit endpoints', () => {
    expect(withStoredBible({ book: 'Psalms', chapter: 51, fromVerse: 1, endChapter: 52, toVerse: 1 }, 'ru'))
      .toEqual({ bible: 'rst', book: 'Psalms', chapter: 50, fromVerse: 1, endChapter: 51, toVerse: 1 });
  });
});
