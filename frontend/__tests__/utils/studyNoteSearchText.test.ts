import { getLocalizedBookName } from '@/(pages)/(private)/studies/bibleData';
import { formatScriptureReference, studyNoteSearchText } from '@/utils/scriptureReference';

/**
 * WHAT A STUDY NOTE IS FOUND BY (BUG-20260927-study-search-drops-by-short-reference).
 * The search text holds a reference the way the card shows it — short and long — and, so that
 * nothing found before is lost, the full name with the stored chapter number.
 */
describe('studyNoteSearchText', () => {
  const note = (ref: { id: string; book: string; chapter?: number; fromVerse?: number; toVerse?: number }) => ({
    title: 'T', content: 'C', tags: ['tag'], scriptureRefs: [ref],
  });

  it('holds a reference as the card shows it, short and long', () => {
    const ref = { id: 'r', book: 'Luke', chapter: 5, fromVerse: 17 };
    const text = studyNoteSearchText(note(ref), 'ru');
    expect(text).toContain(formatScriptureReference(ref, { locale: 'ru', style: 'short' }).toLowerCase());
    expect(text).toContain(formatScriptureReference(ref, { locale: 'ru', style: 'long' }).toLowerCase());
  });

  it('still finds a psalm by the stored number as well as by the one shown', () => {
    const ref = { id: 'r', book: 'Psalms', chapter: 23, fromVerse: 1 };
    const text = studyNoteSearchText(note(ref), 'ru');
    expect(text).toContain(`${getLocalizedBookName('Psalms', 'ru')} 23:1`.toLowerCase());
    expect(text).toContain(formatScriptureReference(ref, { locale: 'ru', style: 'long' }).toLowerCase());
  });

  it('keeps the text the search matched before for a chapter without verses, a verse range and a psalm', () => {
    const legacy = (ref: { book: string; chapter?: number; fromVerse?: number; toVerse?: number }) =>
      `${getLocalizedBookName(ref.book, 'ru')} ${ref.chapter}:${ref.fromVerse}${ref.toVerse ? '-' + ref.toVerse : ''}`.toLowerCase();
    for (const ref of [
      { id: 'a', book: 'Luke', chapter: 5 },
      { id: 'b', book: 'Luke', chapter: 5, fromVerse: 17, toVerse: 26 },
      { id: 'c', book: 'Psalms', chapter: 23 },
    ]) {
      expect(studyNoteSearchText(note(ref), 'ru')).toContain(legacy(ref));
    }
  });

  it('holds title, content and tags too', () => {
    expect(studyNoteSearchText({ title: 'Grace', content: 'Body', tags: ['Hope'], scriptureRefs: [] }, 'en')).toContain('grace body hope');
  });
});
