import { normalizeSpokenScriptureReferences } from '@utils/scriptureReferenceNormalizer';

describe('normalizeSpokenScriptureReferences', () => {
  it('normalizes Russian dictated chapter and verse wording', () => {
    expect(
      normalizeSpokenScriptureReferences('Прочитай Второзаконие 10 глава 11 стих.')
    ).toBe('Прочитай Втор. 10:11.');
  });

  it('normalizes Russian dictated verse ranges', () => {
    expect(
      normalizeSpokenScriptureReferences('Это похоже на Луки 15 глава с 11 по 32 стих.')
    ).toBe('Это похоже на Лк. 15:11-32.');
  });

  it('supports common genitive book forms from dictation', () => {
    expect(
      normalizeSpokenScriptureReferences('В Евангелии от Иоанна 3 глава 16 стих сказано о любви Бога.')
    ).toBe('В Евангелии Ин. 3:16 сказано о любви Бога.');
  });

  it('keeps existing references stable except for prose spacing', () => {
    expect(
      normalizeSpokenScriptureReferences('Смотри Второзаконие 10:11 и Ин. 3:16.')
    ).toBe('Смотри Втор. 10:11 и Ин. 3:16.');
  });

  it('does not rewrite ambiguous book-name-plus-number phrases without a reference signal', () => {
    expect(normalizeSpokenScriptureReferences('Марк 10 лет служил в церкви.')).toBe(
      'Марк 10 лет служил в церкви.'
    );
  });

  it('keeps English references in English output', () => {
    expect(normalizeSpokenScriptureReferences('Read John 3:16 today.')).toBe('Read John 3:16 today.');
  });
});
