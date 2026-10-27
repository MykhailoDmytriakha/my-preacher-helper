import { copiedPlace, defaultCopyFormat, quotesFor, verseCopyText } from '@/utils/verseCopy';

const ru = { book: 'Рим', bible: 'Синодальный перевод', quotes: quotesFor('ru') };
const en = { book: 'Rom', bible: 'King James Version', quotes: quotesFor('en') };

const ROMANS_8 = {
  7: 'потому что плотские помышления суть вражда против Бога; ибо закону Божию не покоряются, да и не могут.',
  28: 'Притом знаем, что любящим Бога, призванным по Его изволению, все содействует ко благу.',
  29: 'Ибо кого Он предузнал, тем и предопределил быть подобными образу Сына Своего, дабы Он был первородным между многими братиями.',
  30: 'А кого Он предопределил, тех и призвал, а кого призвал, тех и оправдал; а кого оправдал, тех и прославил.',
  32: 'Тот, Который Сына Своего не пощадил, но предал Его за всех нас, как с Ним не дарует нам и всего?',
  38: 'Ибо я уверен, что ни смерть, ни жизнь, ни Ангелы, ни Начала, ни Силы, ни настоящее, ни будущее,',
} as const;
const verse = (n: keyof typeof ROMANS_8, chapter = 8) => ({ chapter, verse: n, words: ROMANS_8[n] });

describe('verseCopy — a verse taken out of the Bible', () => {
  it('one verse goes as a quote with its place and its Bible', () => {
    expect(verseCopyText([verse(28)], 'quote', ru)).toBe(
      '«Притом знаем, что любящим Бога, призванным по Его изволению, все содействует ко благу.»\n— Рим 8:28 (Синодальный перевод)'
    );
  });

  it('a verse that starts in the middle of a sentence opens with «…», one that stops at a comma ends with it', () => {
    expect(verseCopyText([verse(7)], 'quote', ru)).toBe(`«…${ROMANS_8[7]}»\n— Рим 8:7 (Синодальный перевод)`);
    expect(verseCopyText([verse(38)], 'quote', ru)).toBe(`«${ROMANS_8[38].slice(0, -1)}…»\n— Рим 8:38 (Синодальный перевод)`);
  });

  it('several verses go as the place and the verses numbered, in the order of the Bible', () => {
    expect(verseCopyText([verse(30), verse(28), verse(29)], 'numbered', ru)).toBe(
      ['Рим 8:28–30 (Синодальный перевод)', `28 ${ROMANS_8[28]}`, `29 ${ROMANS_8[29]}`, `30 ${ROMANS_8[30]}`].join('\n')
    );
  });

  it('a gap between verses is said in both forms', () => {
    expect(verseCopyText([verse(28), verse(30)], 'numbered', ru)).toBe(
      ['Рим 8:28, 30 (Синодальный перевод)', `28 ${ROMANS_8[28]}`, '…', `30 ${ROMANS_8[30]}`].join('\n')
    );
    expect(verseCopyText([verse(28), verse(30)], 'quote', ru)).toBe(`«${ROMANS_8[28]} … ${ROMANS_8[30]}»\n— Рим 8:28, 30 (Синодальный перевод)`);
  });

  it('verses of two chapters carry their chapter in the numbers; the seam is no gap where the chapter ends', () => {
    const nine = { chapter: 9, verse: 1, words: 'Истину говорю во Христе, не лгу,' };
    const thirtyNine = { chapter: 8, verse: 39, words: 'ни высота, ни глубина, ни другая какая тварь не может отлучить нас от любви Божией во Христе Иисусе, Господе нашем.' };
    const length = (chapter: number) => ({ 8: 39, 9: 33 } as Record<number, number>)[chapter];
    expect(verseCopyText([thirtyNine, nine], 'numbered', ru, length).split('\n'))
      .toEqual(['Рим 8:39; 9:1 (Синодальный перевод)', `8:39 ${thirtyNine.words}`, `9:1 ${nine.words}`]);
    // 8:38 and 9:1 leave 8:39 out: that is a gap.
    expect(verseCopyText([verse(38), nine], 'numbered', ru, length).split('\n'))
      .toEqual(['Рим 8:38; 9:1 (Синодальный перевод)', `8:38 ${ROMANS_8[38]}`, '…', `9:1 ${nine.words}`]);
  });

  it('a piece of a verse says where it was cut', () => {
    expect(verseCopyText([{ chapter: 8, verse: 31, words: 'на это? Если Бог за нас', cutStart: true, cutEnd: true }], 'quote', ru))
      .toBe('«…на это? Если Бог за нас…»\n— Рим 8:31 (Синодальный перевод)');
    expect(verseCopyText([
      { chapter: 8, verse: 34, words: 'Христос Иисус умер', cutStart: true },
      { chapter: 8, verse: 35, words: 'Кто отлучит нас', cutEnd: true },
    ], 'numbered', ru).split('\n')).toEqual(['Рим 8:34–35 (Синодальный перевод)', '34 …Христос Иисус умер', '35 Кто отлучит нас…']);
  });

  it('speaks the quotation marks of the Bible’s language', () => {
    expect(verseCopyText([{ chapter: 8, verse: 28, words: 'And we know that all things work together for good to them that love God.' }], 'quote', en))
      .toBe('“And we know that all things work together for good to them that love God.”\n— Rom 8:28 (King James Version)');
  });

  it('the place of verses, and the form a count of verses starts with', () => {
    expect(copiedPlace('Рим', [{ chapter: 8, verse: 32 }, { chapter: 8, verse: 28 }, { chapter: 8, verse: 29 }, { chapter: 8, verse: 28 }])).toBe('Рим 8:28–29, 32');
    expect(defaultCopyFormat(1)).toBe('quote');
    expect(defaultCopyFormat(3)).toBe('numbered');
    expect(verseCopyText([], 'quote', ru)).toBe('');
  });
});
