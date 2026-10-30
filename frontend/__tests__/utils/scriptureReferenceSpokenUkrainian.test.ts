import { PROTESTANT_BOOKS } from '@/components/bible/bookOrder';
import { referencesInText } from '@/utils/bibleLink';
import { readLine } from '@/utils/bibleSearch/query';
import { normalizeScriptureReferencesForTts, normalizeSpokenScriptureReferences } from '@/utils/scriptureReferenceNormalizer';

const samples: Array<[string, string, string, number, number?, number?]> = [
  ['Івана 3 розділ 16 вірш', 'Івана 3:16', 'John', 3, 16],
  ['Івана 3 глава 16 вірш', 'Івана 3:16', 'John', 3, 16],
  ['Івана 3-тя глава 16-й вірш', 'Івана 3:16', 'John', 3, 16],
  ['Івана 3-й розділ 16-й вірш', 'Івана 3:16', 'John', 3, 16],
  ['Івана 1-ша глава 3-й вірш', 'Івана 1:3', 'John', 1, 3],
  ['Буття 2-га глава 7-й вірш', 'Буття 2:7', 'Genesis', 2, 7],
  ['Івана 3-тя глава 16-го вірша', 'Івана 3:16', 'John', 3, 16],
  ['Івана 3-ї глави 16-й вірш', 'Івана 3:16', 'John', 3, 16],
  ['Івана 3 розділ з 16 по 18 вірші', 'Івана 3:16-18', 'John', 3, 16, 18],
  ['Івана 3 розділ від 16 до 18 віршів', 'Івана 3:16-18', 'John', 3, 16, 18],
  ['Івана 3 розділ 16-18 вірші', 'Івана 3:16-18', 'John', 3, 16, 18],
  ['Івана 3 розділу 16 вірша', 'Івана 3:16', 'John', 3, 16],
  ['Івана 3 розділ', 'Ів. 3', 'John', 3],
  ['Івана 3-тя глава', 'Ів. 3', 'John', 3],
  ['Буття 2-га глава', 'Бут. 2', 'Genesis', 2],
];

const cases = samples.map(([raw, canonical, book, chapter, verse, toVerse]) => ({raw, canonical, book, chapter, verse, toVerse}));

describe('Ukrainian digital Scripture wording uses the shared reader', () => {
  it.each(cases)('normalizes the complete $raw to its canonical place', ({raw, canonical}) => {
    const expected = normalizeSpokenScriptureReferences('Сьогодні: '+canonical);
    const normalized = normalizeSpokenScriptureReferences('Сьогодні: '+raw);
    expect(normalized).toBe(expected);
    expect(normalized).not.toBe('Сьогодні: '+raw);
    expect(normalizeSpokenScriptureReferences(normalized)).toBe(normalized);
  });

  it.each(cases)('opens $raw as the same Bible destination', ({raw, book:bookId, chapter, verse, toVerse}) => {
    expect(readLine(raw, { bible: 'ubio', books: PROTESTANT_BOOKS })).toMatchObject({
      kind: 'place', bookId, chapter, verse: verse ?? null, toVerse: toVerse ?? null,
    });
  });

  it.each(cases)('renders one complete reference after normalizing $raw', ({raw, book, chapter, verse, toVerse}) => {
    const normalized = normalizeSpokenScriptureReferences('Сьогодні: '+raw);
    const refs = referencesInText(normalized, 'uk');
    expect(refs).toHaveLength(1);
    expect(refs[0].raw).toBe(normalized.slice('Сьогодні: '.length));
    expect(refs[0].reference).toMatchObject({book, chapter, ...(verse === undefined ? {} : {fromVerse:verse}), ...(toVerse === undefined ? {} : {toVerse})});
  });

  it.each(['Напиши вірш про любов', 'Івана розділ вірш', 'Марку 3 роки', 'Івана 3-невідоме глава 16 вірш', 'Це 3 розділи та 16 віршів', 'Івана 3 розділення та 16 віршів', 'Івана 3 розділові знаки', 'Івана 3 розділ2026', 'Івана 3 розділ_плану'])('keeps ordinary or incomplete %s intact', raw => {
    expect(normalizeSpokenScriptureReferences(raw)).toBe(raw);
  });

  it.each(['віршування', 'віршик'])('preserves a following %s as prose while reading the already complete numeric place', word => {
    expect(normalizeSpokenScriptureReferences('Сьогодні: Івана 3 розділ 16 '+word)).toBe('Сьогодні: Ів. 3:16 '+word);
  });

  it('retains Ukrainian canonical spacing and the written chapter', () => {
    expect(normalizeSpokenScriptureReferences('Сьогодні: Івана 3:16')).toBe('Сьогодні: Ів. 3:16');
    expect(normalizeSpokenScriptureReferences('Сьогодні: Псалом 22 розділ 1 вірш')).toBe('Сьогодні: Пс. 22:1');
  });

  it('retains the existing Russian and English spoken paths', () => {
    expect(normalizeSpokenScriptureReferences('Иоанна 3 глава 16 стих')).toBe('Ин. 3:16');
    expect(normalizeSpokenScriptureReferences('John 3 chapter 16 verse')).toBe('John 3:16');
  });

  it('leaves the existing Russian-only TTS policy separate', () => {
    const text='Сьогодні: Івана 3:16';
    expect(normalizeScriptureReferencesForTts(text)).toBe(text);
  });
});
