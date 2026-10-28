import { COMMENT_SENTENCES, measureComment, WORDS_PER_SENTENCE } from '@/utils/commentLength';

const words = (n: number) => Array.from({ length: n }, (_, i) => `слово${i}`).join(' ');

describe('measureComment — the way from a comment to a note', () => {
  it('is empty and not a note for no text', () => {
    expect(measureComment('')).toEqual({ sentences: 0, share: 0, isNote: false });
  });

  it('counts sentences by words, so dictated text without full stops still measures', () => {
    expect(measureComment(words(WORDS_PER_SENTENCE)).sentences).toBe(1);
    expect(measureComment(words(WORDS_PER_SENTENCE * 3)).share).toBeCloseTo(3 / COMMENT_SENTENCES);
  });

  it('stays a comment at exactly five sentences and becomes a note past them', () => {
    expect(measureComment(words(60)).isNote).toBe(false);
    expect(measureComment(words(61))).toMatchObject({ isNote: true, share: 1 });
  });

  it('counts every list item as at least one sentence', () => {
    expect(measureComment('Три вопроса главы:\n- Кому уподобите?\n- Кто сотворил?\n- Разве не знаешь?').sentences).toBeCloseTo(3 + 3 / WORDS_PER_SENTENCE);
    expect(measureComment(['- а', '- б', '- в', '- г', '- д', '- е'].join('\n')).isNote).toBe(true);
    expect(measureComment('1. один\n2. два').sentences).toBe(2);
  });

  it('takes a list\'s or a quote\'s own mark for no word: an emptied «1.» has nothing in it', () => {
    expect(measureComment('1. ').sentences).toBe(0);
    expect(measureComment('1.').sentences).toBe(0);
    expect(measureComment('  - ').sentences).toBe(0);
    expect(measureComment('> ').sentences).toBe(0);
    expect(measureComment('1.5 мили до города').sentences).toBeCloseTo(4 / WORDS_PER_SENTENCE);
  });

  it('counts the words of `code` too: under the verse they stand like any others', () => {
    const words = Array.from({ length: 70 }, (_, i) => `слово${i}`).join(' ');
    expect(measureComment(`\`${words}\``).isNote).toBe(true);
  });

  it('does not count Markdown marks as words', () => {
    expect(measureComment('**Сила** — *не* ~~моя~~').sentences).toBeCloseTo(3 / WORDS_PER_SENTENCE);
    expect(measureComment('> цитата\n# заголовок').sentences).toBeCloseTo(2 / WORDS_PER_SENTENCE);
  });
});
