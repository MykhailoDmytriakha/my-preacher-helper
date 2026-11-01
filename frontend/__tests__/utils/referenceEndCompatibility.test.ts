import { bibleHref, namesAPlace } from '@/utils/bibleLink';
import { versesHeldIn } from '@/utils/scriptureReferenceNumbering';

import type { ScriptureRefShape } from '@/utils/scriptureReference';

/** Both independently authored branches describe the same exact cross-chapter passage. */
describe.each(['endChapter', 'toVerseChapter'] as const)('stored verse ending: %s', ending => {
  const reference = (end = 5): ScriptureRefShape & { bible: 'rst' } => ({
    bible: 'rst', book: 'Ephesians', chapter: 4, fromVerse: 31, [ending]: end, toVerse: 2,
  });

  it('admits the complete real passage for reader material', () => {
    expect(namesAPlace(reference())).toBe(true);
    expect(versesHeldIn(reference(), 'rst').map(({ chapter, verse }) => `${chapter}:${verse}`))
      .toEqual(['4:31', '4:32', '5:1', '5:2']);
  });

  it('opens the complete passage from a stored-reference link', () => {
    const url = new URL(bibleHref(reference(), { locale: 'ru' })!, 'https://app.invalid');
    expect(url.searchParams.get('at')).toBe('4:31');
    expect(url.searchParams.get('to')).toBe('5:2');
  });

  it('refuses an ending outside the book', () => {
    expect(namesAPlace(reference(99))).toBe(false);
    expect(versesHeldIn(reference(99), 'rst')).toEqual([]);
  });
});
