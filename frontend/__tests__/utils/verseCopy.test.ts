import { copiedPlace, defaultCopyFormat, verseCopyText } from '@/utils/verseCopy';

// The names of a reader whose interface speaks the Bible's language: the Bible is not named.
const ru = { book: 'Рим' };
// A Bible that is not the interface's own carries its short mark.
const kjvInRussian = { book: 'Rom', mark: 'KJV' };

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
  it('one verse goes as its place, a colon and the verse in straight quotes (the owner’s example)', () => {
    expect(verseCopyText([{ chapter: 47, verse: 4, words: 'Искупитель наш — Господь Саваоф имя Ему, Святый Израилев.' }], 'quote', { book: 'Ис' }))
      .toBe('Ис 47:4: "Искупитель наш — Господь Саваоф имя Ему, Святый Израилев."');
    expect(verseCopyText([verse(28)], 'quote', ru)).toBe(
      'Рим 8:28: "Притом знаем, что любящим Бога, призванным по Его изволению, все содействует ко благу."'
    );
  });

  it('the Bible is named, in parentheses after the place, only when the names carry its mark', () => {
    const isaiah = [{ chapter: 47, verse: 4, words: 'As for our redeemer, the LORD of hosts is his name, the Holy One of Israel.' }];
    expect(verseCopyText(isaiah, 'quote', { book: 'Isa' }))
      .toBe('Isa 47:4: "As for our redeemer, the LORD of hosts is his name, the Holy One of Israel."');
    expect(verseCopyText(isaiah, 'quote', { book: 'Isa', mark: 'KJV' }))
      .toBe('Isa 47:4 (KJV): "As for our redeemer, the LORD of hosts is his name, the Holy One of Israel."');
    // Several verses name it on the line that carries the place, in both forms.
    expect(verseCopyText([verse(28), verse(29)], 'numbered', kjvInRussian).split('\n')[0]).toBe('Rom 8:28–29 (KJV):');
    expect(verseCopyText([verse(28), verse(29)], 'quote', kjvInRussian).startsWith('Rom 8:28–29 (KJV): "')).toBe(true);
  });

  it('every language quotes with straight double quotes, and the quotation marks inside a verse stay as they are', () => {
    expect(verseCopyText([{ chapter: 8, verse: 28, words: 'And we know that all things work together for good to them that love God.' }], 'quote', { book: 'Rom' }))
      .toBe('Rom 8:28: "And we know that all things work together for good to them that love God."');
    expect(verseCopyText([{ chapter: 1, verse: 1, words: 'Сказал он: «Иди»; и “так” было.' }], 'quote', { book: 'Быт' }))
      .toBe('Быт 1:1: "Сказал он: «Иди»; и “так” было."');
  });

  it('a verse that starts in the middle of a sentence opens with «…», one that stops at a comma ends with it', () => {
    expect(verseCopyText([verse(7)], 'quote', ru)).toBe(`Рим 8:7: "…${ROMANS_8[7]}"`);
    expect(verseCopyText([verse(38)], 'quote', ru)).toBe(`Рим 8:38: "${ROMANS_8[38].slice(0, -1)}…"`);
  });

  it('several verses go numbered under the place and a colon, in the order of the Bible', () => {
    expect(verseCopyText([verse(30), verse(28), verse(29)], 'numbered', ru)).toBe(
      ['Рим 8:28–30:', `28 ${ROMANS_8[28]}`, `29 ${ROMANS_8[29]}`, `30 ${ROMANS_8[30]}`].join('\n')
    );
  });

  it('several verses as a quote: the place, a colon, the words of the runs in one pair of quotes', () => {
    expect(verseCopyText([verse(29), verse(28)], 'quote', ru)).toBe(`Рим 8:28–29: "${ROMANS_8[28]} ${ROMANS_8[29]}"`);
    // Two runs: the gap is said, the place lists both.
    expect(verseCopyText([verse(30), verse(28)], 'quote', ru)).toBe(`Рим 8:28, 30: "${ROMANS_8[28]} … ${ROMANS_8[30]}"`);
  });

  it('a gap between verses is said in both forms', () => {
    expect(verseCopyText([verse(28), verse(30)], 'numbered', ru)).toBe(
      ['Рим 8:28, 30:', `28 ${ROMANS_8[28]}`, '…', `30 ${ROMANS_8[30]}`].join('\n')
    );
    expect(verseCopyText([verse(28), verse(30)], 'quote', ru)).toBe(`Рим 8:28, 30: "${ROMANS_8[28]} … ${ROMANS_8[30]}"`);
  });

  it('verses of two chapters carry their chapter in the numbers; the seam is no gap where the chapter ends', () => {
    const nine = { chapter: 9, verse: 1, words: 'Истину говорю во Христе, не лгу,' };
    const thirtyNine = { chapter: 8, verse: 39, words: 'ни высота, ни глубина, ни другая какая тварь не может отлучить нас от любви Божией во Христе Иисусе, Господе нашем.' };
    const length = (chapter: number) => ({ 8: 39, 9: 33 } as Record<number, number>)[chapter];
    expect(verseCopyText([thirtyNine, nine], 'numbered', ru, length).split('\n'))
      .toEqual(['Рим 8:39; 9:1:', `8:39 ${thirtyNine.words}`, `9:1 ${nine.words}`]);
    // 8:38 and 9:1 leave 8:39 out: that is a gap.
    expect(verseCopyText([verse(38), nine], 'numbered', ru, length).split('\n'))
      .toEqual(['Рим 8:38; 9:1:', `8:38 ${ROMANS_8[38]}`, '…', `9:1 ${nine.words}`]);
  });

  it('a piece of a verse says where it was cut', () => {
    expect(verseCopyText([{ chapter: 8, verse: 31, words: 'на это? Если Бог за нас', cutStart: true, cutEnd: true }], 'quote', ru))
      .toBe('Рим 8:31: "…на это? Если Бог за нас…"');
    expect(verseCopyText([
      { chapter: 8, verse: 34, words: 'Христос Иисус умер', cutStart: true },
      { chapter: 8, verse: 35, words: 'Кто отлучит нас', cutEnd: true },
    ], 'numbered', ru).split('\n')).toEqual(['Рим 8:34–35:', '34 …Христос Иисус умер', '35 Кто отлучит нас…']);
  });

  it('the place of verses, and the form a count of verses starts with', () => {
    expect(copiedPlace('Рим', [{ chapter: 8, verse: 32 }, { chapter: 8, verse: 28 }, { chapter: 8, verse: 29 }, { chapter: 8, verse: 28 }])).toBe('Рим 8:28–29, 32');
    expect(defaultCopyFormat(1)).toBe('quote');
    expect(defaultCopyFormat(3)).toBe('numbered');
    expect(verseCopyText([], 'quote', ru)).toBe('');
  });
});
