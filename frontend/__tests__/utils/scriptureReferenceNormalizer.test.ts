import {
  normalizeScriptureReferencesForTts,
  normalizeSpokenScriptureReferences,
} from '@utils/scriptureReferenceNormalizer';

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

  it('keeps a dictated Psalm on the number said', () => {
    expect(normalizeSpokenScriptureReferences('Пс 22 глава 1 стих')).toBe('Пс. 22:1');
    expect(normalizeSpokenScriptureReferences('Psalm 23 chapter 1 verse')).toBe('Ps 23:1');
  });

  it('keeps existing references stable except for prose spacing', () => {
    expect(
      normalizeSpokenScriptureReferences('Смотри Второзаконие 10:11 и Ин. 3:16.')
    ).toBe('Смотри Втор. 10:11 и Ин. 3:16.');
  });

  it('does not reformat already compact dotted references from model output', () => {
    expect(
      normalizeSpokenScriptureReferences('Прочитаем Прит. 3:5 и посмотрим на доверие Богу.')
    ).toBe('Прочитаем Прит. 3:5 и посмотрим на доверие Богу.');
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

describe('normalizeScriptureReferencesForTts', () => {
  it('expands Russian written references into spoken chapter and verse wording', () => {
    expect(
      normalizeScriptureReferencesForTts('Матфея 24:42: "Итак бодрствуйте".')
    ).toBe('Матфея, двадцать четвертая глава, сорок второй стих: "Итак бодрствуйте".');
  });

  it('expands common Russian book abbreviations before TTS', () => {
    expect(
      normalizeScriptureReferencesForTts('Смотри Мат 24:42 и Ин. 3:16.')
    ).toBe(
      'Смотри Матфея, двадцать четвертая глава, сорок второй стих и Иоанна, третья глава, шестнадцатый стих.'
    );
  });

  it('expands Russian verse ranges into spoken range wording', () => {
    expect(
      normalizeScriptureReferencesForTts('Прочитай Луки 15:11-32.')
    ).toBe('Прочитай Луки, пятнадцатая глава, стихи с одиннадцатого по тридцать второй.');
  });

  it('speaks the displayed Psalm chapter number instead of storage numbering', () => {
    expect(
      normalizeScriptureReferencesForTts('Пс 22:1 напоминает о доверии.')
    ).toBe('Псалтирь, двадцать вторая глава, первый стих напоминает о доверии.');
  });

  it('expands compact reference formats from the audio export sample text', () => {
    const normalized = normalizeScriptureReferencesForTts([
      'Мф. 26:41',
      'Мф. 24:44-46',
      'Иуда 1:3',
      'Неем 8:8',
      '2 Кор. 5:7',
      'Откр. 22:20',
      'Лк. 21:34',
      'В Пс. 118:70',
      'Евр. 11:17',
      '1 Кор. 16:12',
      'Мк. 11:3',
      'Гал. 6:9-10',
      'Иак. 2:18',
      '2 Пет. 1:5',
      '1 Тим. 4:15',
      'Мат 26:41',
      'Лук 21:36',
    ].join('; '));

    expect(normalized).not.toMatch(/\d+:\d+/);
    expect(normalized).toContain('Матфея, двадцать шестая глава, сорок первый стих');
    expect(normalized).toContain('Иуды, первая глава, третий стих');
    expect(normalized).toContain('Псалтирь, сто восемнадцатая глава, семидесятый стих');
    expect(normalized).toContain('1 Коринфянам, шестнадцатая глава, двенадцатый стих');
    expect(normalized).toContain('Галатам, шестая глава, стихи с девятого по десятый');
  });

  it('leaves non-Russian references unchanged', () => {
    expect(normalizeScriptureReferencesForTts('Read John 3:16 today.')).toBe('Read John 3:16 today.');
  });
});

/*
 * A reference a preacher writes stays the book they meant (case 2026-10-12-block-diagram, L4): the text's own language
 * reads it — «1 Цар» in Ukrainian is 1 Kings and was rewritten «1Сам.» — and «Фил» is Philippians, never Philemon,
 * which has one chapter (Russian «Фил 4:13» was rewritten «Флм. 4:13», a place that does not exist).
 */
describe('a reference keeps the book it was written for', () => {
  it('reads a Ukrainian text in Ukrainian', () => {
    expect(normalizeSpokenScriptureReferences('Читаємо 1 Цар 3:5 і молимось')).toBe('Читаємо 1Цар. 3:5 і молимось');
  });

  it('knows a Ukrainian name whatever the shape of its apostrophe', () => {
    expect(normalizeSpokenScriptureReferences('Об’явлення 3:20 — Ісус стукає')).toBe('Об. 3:20 — Ісус стукає');
    expect(normalizeSpokenScriptureReferences('Филипʼян 4:13 — все можу')).toBe('Флп. 4:13 — все можу');
  });

  it('reads «Фил» as Philippians', () => {
    expect(normalizeSpokenScriptureReferences('Фил 4:13 все могу')).toBe('Флп. 4:13 все могу');
  });
});
