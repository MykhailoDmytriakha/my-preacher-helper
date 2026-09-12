import { formatRussianOrdinal } from '@utils/russianOrdinals';

describe('formatRussianOrdinal', () => {
  it.each([
    ['masculine', 1, 'первый'],
    ['feminine', 1, 'первая'],
    ['genitiveMasculine', 1, 'первого'],
    ['masculine', 11, 'одиннадцатый'],
    ['feminine', 19, 'девятнадцатая'],
    ['genitiveMasculine', 12, 'двенадцатого'],
  ] as const)('formats %s value %s as %s', (form, value, expected) => {
    expect(formatRussianOrdinal(value, form)).toBe(expected);
  });

  it.each([
    ['masculine', 20, 'двадцатый'],
    ['feminine', 40, 'сороковая'],
    ['genitiveMasculine', 90, 'девяностого'],
  ] as const)('formats exact tens in %s form', (form, value, expected) => {
    expect(formatRussianOrdinal(value, form)).toBe(expected);
  });

  it.each([
    ['masculine', 21, 'двадцать первый'],
    ['feminine', 34, 'тридцать четвертая'],
    ['genitiveMasculine', 58, 'пятьдесят восьмого'],
  ] as const)('formats compound tens in %s form', (form, value, expected) => {
    expect(formatRussianOrdinal(value, form)).toBe(expected);
  });

  it.each([
    ['masculine', 100, 'сотый'],
    ['feminine', 400, 'четырехсотая'],
    ['genitiveMasculine', 900, 'девятисотого'],
  ] as const)('formats exact hundreds in %s form', (form, value, expected) => {
    expect(formatRussianOrdinal(value, form)).toBe(expected);
  });

  it.each([
    ['masculine', 101, 'сто первый'],
    ['feminine', 234, 'двести тридцать четвертая'],
    ['genitiveMasculine', 999, 'девятьсот девяносто девятого'],
  ] as const)('formats compound hundreds in %s form', (form, value, expected) => {
    expect(formatRussianOrdinal(value, form)).toBe(expected);
  });

  it.each([0, -1, 1000, 12.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'falls back to the numeric string for unsupported value %s',
    (value) => {
      expect(formatRussianOrdinal(value, 'masculine')).toBe(String(value));
    }
  );
});
