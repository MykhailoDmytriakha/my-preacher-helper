import { placeFromReference } from '@/components/bible/goTo';

describe('placeFromReference', () => {
  it.each([
    ['Ин 3:16', { bookId: 'John', chapter: 3, verse: 16 }],
    ['ин 3 16', { bookId: 'John', chapter: 3, verse: 16 }],
    ['1 Кор 13', { bookId: '1 Corinthians', chapter: 13, verse: 1 }],
    ['Быт', { bookId: 'Genesis', chapter: 1, verse: 1 }],
    ['Рим 5:9', { bookId: 'Romans', chapter: 5, verse: 9 }],
    ['John 3:16', { bookId: 'John', chapter: 3, verse: 16 }],
    // The examples the hints show, in every interface language.
    ['Gen 1', { bookId: 'Genesis', chapter: 1, verse: 1 }],
    ['Ps 22', { bookId: 'Psalms', chapter: 22, verse: 1 }],
    ['Jude 3', { bookId: 'Jude', chapter: 1, verse: 3 }],
    ['Ів 3:16', { bookId: 'John', chapter: 3, verse: 16 }],
    ['Бут 1', { bookId: 'Genesis', chapter: 1, verse: 1 }],
    ['Юд 3', { bookId: 'Jude', chapter: 1, verse: 3 }],
  ])('opens %s where it points', (raw, place) => {
    expect(placeFromReference(raw, 'rst')).toEqual(place);
  });

  it('keeps a psalm number as the Synodal text shows it', () => {
    expect(placeFromReference('Пс 22', 'rst')).toEqual({ bookId: 'Psalms', chapter: 22, verse: 1 });
    expect(placeFromReference('Пс 50:12', 'rst')).toEqual({ bookId: 'Psalms', chapter: 50, verse: 12 });
  });

  it('reads the number after a book of one chapter as its verse', () => {
    expect(placeFromReference('Иуд 3', 'rst')).toEqual({ bookId: 'Jude', chapter: 1, verse: 3 });
    expect(placeFromReference('Иуд 1:3', 'rst')).toEqual({ bookId: 'Jude', chapter: 1, verse: 3 });
    expect(placeFromReference('Флм', 'rst')).toEqual({ bookId: 'Philemon', chapter: 1, verse: 1 });
  });

  it('counts the chapters of the Bible being read: Joel 4 is a chapter of Ohienko only', () => {
    expect(placeFromReference('Иоиль 4:1', 'ubio')).toEqual({ bookId: 'Joel', chapter: 4, verse: 1 });
    expect(placeFromReference('Иоиль 4:1', 'rst')).toBeNull();
  });

  it.each(['', '   ', '3', 'Ин 30', 'нечто 3:16'])('finds no place in %p', (raw) => {
    expect(placeFromReference(raw, 'rst')).toBeNull();
  });
});
