import { detectTextLocale, textLanguage, type AppLocale } from '@/utils/appLocale';
import { leadingReference, referenceFromTyped, referencesInText } from '@/utils/bibleLink';
import { passagesIn } from '@/utils/scriptureReferenceNumbering';

/*
 * A REFERENCE TYPED IN TEXT IS READ IN THE BIBLE IT WAS WRITTEN IN, whatever the reader's interface
 * (the owner, 2026-10-20, case 2026-10-12-block-diagram, 2.2.1): the language of its book's name says
 * which — "Ps" the King James, "Иоил" the Synodal, "Йоїл" Ohienko; where Russian and Ukrainian write
 * the book alike ("Пс", "1Цар") the words of the text decide, and then the interface. The documents
 * are the ones on the case canvas (row 2.2.1); `meant` is the verse the author meant, as the King
 * James numbers it.
 */
const DOCUMENTS = [
  { name: 'a Russian sermon', text: 'Господь — Пастырь мой (Пс 22:1). Самуил прибежал к Илию — 1Цар 3:5. Излию от Духа Моего — Иоил 2:28. Так возлюбил Бог мир — Ин 3:16.',
    meant: ['Psalms 23:1', '1 Samuel 3:5', 'Joel 2:28', 'John 3:16'] },
  { name: 'an English sermon', text: 'The LORD is my shepherd — Ps 23:1. I will pour out my spirit — Joel 2:28. For God so loved the world — John 3:16.',
    meant: ['Psalms 23:1', 'Joel 2:28', 'John 3:16'] },
  { name: 'a Ukrainian note', text: 'Господь — мій Пастир (Пс 22:1). Господь з’явився Соломонові уві сні — 1Цар 3:5. Виллю Мого Духа — Йоїл 3:1.',
    meant: ['Psalms 23:1', '1 Kings 3:5', 'Joel 2:28'] },
  { name: 'a Russian sermon quoting an English book', text: 'Сперджен пишет о Ps 23:1: «самое короткое слово в нём — „мой“». У нас этот стих — Пс 22:1.',
    meant: ['Psalms 23:1', 'Psalms 23:1'] },
];
const INTERFACES: AppLocale[] = ['ru', 'uk', 'en'];

const inKingJames = (found: ReturnType<typeof referencesInText>[number]) => {
  const place = passagesIn(found.reference, 'kjv')[0];
  return `${found.reference.book} ${place.chapter}:${place.fromVerse}`;
};

describe('a reference typed in text', () => {
  it.each(DOCUMENTS.flatMap((document) => INTERFACES.map((locale) => [document.name, locale, document] as const)))(
    'in %s under the %s interface opens the verse its author meant',
    (_name, locale, document) => {
      const found = referencesInText(document.text, locale, textLanguage(document.text));
      expect(found.map(inKingJames)).toEqual(document.meant);
    },
  );

  it('is marked with its Bible only where the reader, reading its letters, would land elsewhere', () => {
    const marks = (text: string, locale: AppLocale) => referencesInText(text, locale, textLanguage(text)).map((found) => `${found.raw}${found.writtenIn ? ` (${found.writtenIn})` : ''}`);
    // The Synodal "Пс 22:1" is Ps 23:1 of the King James; John 3:16 is John 3:16 in both.
    expect(marks(DOCUMENTS[0].text, 'en')).toEqual(['Пс 22:1 (rst)', '1Цар 3:5', 'Иоил 2:28', 'Ин 3:16']);
    // A Ukrainian "1Цар" is the Russian "3Цар": the same numbers, another book for a Russian reader.
    expect(marks(DOCUMENTS[2].text, 'ru')).toEqual(['Пс 22:1', '1Цар 3:5 (ubio)', 'Йоїл 3:1 (ubio)']);
    // "Joel 2:28" is Иоил 2:28 for a Russian reader too; "Ps 23:1" is not Пс 23:1.
    expect(marks(DOCUMENTS[1].text, 'ru')).toEqual(['Ps 23:1 (kjv)', 'Joel 2:28', 'John 3:16']);
    // In its own language nothing is marked.
    expect(marks(DOCUMENTS[0].text, 'ru')).toEqual(['Пс 22:1', '1Цар 3:5', 'Иоил 2:28', 'Ин 3:16']);
  });

  it('with no words around it to tell Russian from Ukrainian, is read in the interface', () => {
    const book = (locale: AppLocale) => referencesInText('1Цар 3:5', locale, textLanguage('1Цар 3:5'))[0]?.reference.book;
    expect(book('ru')).toBe('1 Samuel');
    expect(book('uk')).toBe('1 Kings');
  });
});

describe('the language of a text', () => {
  it('is decided by most of its letters, not by one: a typed "і" leaves a Russian text Russian', () => {
    expect(detectTextLocale('Это вера, которая несёт друзів через крышу')).toBe('ru');
  });

  it('stays English for an English text with a Russian word in it', () => {
    expect(detectTextLocale('In Russian churches people answer «Аминь» at the end of a prayer')).toBe('en');
  });

  it('is not said for Cyrillic with none of the letters that tell Russian from Ukrainian', () => {
    expect(textLanguage('1Цар 3:5')).toBeNull();
    expect(detectTextLocale('1Цар 3:5')).toBe('ru');
  });
});

// Found by a second engine (Codex) breaking the change, 2026-10-21.
describe('a typed reference — the cases a second reading broke', () => {
  it('reads a spelling the book table does not hold by its alphabet: "Псал 22:1" typed into an English note is the Synodal psalm', () => {
    const typed = referenceFromTyped('Псал 22:1', { locale: 'en', written: 'en' });
    expect(typed).toMatchObject({ bible: 'rst', book: 'Psalms', chapter: 22, fromVerse: 1 });
  });

  it('marks a sermon\'s opening verse for the reader its letters would mislead', () => {
    expect(leadingReference('Пс 22:1 — «Господь — Пастырь мой»', { locale: 'en' })?.writtenIn).toBe('rst');
    expect(leadingReference('Пс 22:1 — «Господь — Пастырь мой»', { locale: 'ru' })?.writtenIn).toBeUndefined();
  });
});

describe('the language of a text — what is not its words', () => {
  it('leaves an address and a link\'s target out: a long English address does not make Russian prose English', () => {
    expect(textLanguage('Вы — соль земли. https://www.biblegateway.com/passage/?search=Matthew+5&version=KJV')).toBe('ru');
    expect(textLanguage('Вы — соль земли, [смотри здесь](https://www.biblegateway.com/passage/?search=Matthew+5&version=KJV)')).toBe('ru');
  });
});

/*
 * A Ukrainian document under a Russian interface (case 2026-10-12-block-diagram, L4; Codex review 2026-10-27): a short
 * form only Ukrainian writes («Пр.», «Ав.», «1 М.») is a reference there — the check of its name read the interface's
 * language alone and dropped it before the document's language was asked.
 */
describe('a Ukrainian document read under a Russian interface', () => {
  it('links the forms only Ukrainian writes', () => {
    const books = (text: string) => referencesInText(text, 'ru', 'uk').map((found) => found.reference.book);
    expect(books('Пр. 3:5 — Довіряй Господу всім своїм серцем')).toEqual(['Proverbs']);
    expect(books('Ав. 2:4 — праведний житиме вірою')).toEqual(['Habakkuk']);
    expect(leadingReference('1 М. 3:15 — перше Євангеліє', { locale: 'ru', written: 'uk' })?.reference.book).toBe('Genesis');
  });
});
