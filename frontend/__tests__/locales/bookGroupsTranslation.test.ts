import en from '@locales/en/translation.json';
import ru from '@locales/ru/translation.json';
import uk from '@locales/uk/translation.json';

import { PROTESTANT_BOOKS, SYNODAL_BOOKS } from '@/components/bible/bookOrder';

/*
 * The «?» memo beside a Testament reads its texts by keys built from the groups and parts of `bookOrder`
 * (`BookGroupsHelp`), which the literal-key coverage test cannot see: every group and part is checked here.
 */
type Memo = {
  groups: Record<string, string>;
  bookGroupsHelp: { title: Record<string, string>; groups: Record<string, string> };
  bookParts: Record<string, { name: string; memo: string }>;
};
const locales = { en: en.bible as unknown as Memo, ru: ru.bible as unknown as Memo, uk: uk.bible as unknown as Memo };
const groups = [...SYNODAL_BOOKS, ...PROTESTANT_BOOKS].flatMap((testament) => testament.groups);

describe.each(Object.entries(locales))('the books memo in %s', (_, bible) => {
  it('names every Testament, every group and every part, with words to remember it by', () => {
    for (const key of ['old', 'new']) expect(bible.bookGroupsHelp.title[key]).toBeTruthy();
    for (const group of groups) {
      expect(bible.groups[group.key]).toBeTruthy();
      expect(bible.bookGroupsHelp.groups[group.key]).toBeTruthy();
      for (const part of group.parts ?? []) {
        expect(bible.bookParts[part.key]?.name).toBeTruthy();
        expect(bible.bookParts[part.key]?.memo).toBeTruthy();
      }
    }
  });
});
