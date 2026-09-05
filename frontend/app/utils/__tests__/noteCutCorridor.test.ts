import {
  countParagraphs,
  countWords,
  expectedScratchCountCorridor,
  measureNoteForCut,
} from '@/utils/noteCutCorridor';

/** A note of `words` words spread over `paragraphs` blocks, the way the editor stores it. */
function note(words: number, paragraphs = 1): string {
  const perParagraph = Math.max(1, Math.round(words / paragraphs));
  const blocks: string[] = [];
  let left = words;
  for (let i = 0; i < paragraphs; i += 1) {
    const take = i === paragraphs - 1 ? left : Math.min(perParagraph, left);
    if (take <= 0) break;
    blocks.push(Array.from({ length: take }, () => 'слово').join(' '));
    left -= take;
  }
  return blocks.join('\n\n');
}

describe('countWords', () => {
  it('counts what a person would count, not markup', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('## Заголовок\n\nОдна **мысль** — и всё.')).toBe(5);
    expect(countWords('- пункт\n- второй пункт')).toBe(3);
  });

  it('reads link text and ignores its address, code and tags', () => {
    expect(countWords('см. [книгу Иависа](https://example.com/a/b/c)')).toBe(3);
    expect(countWords('текст\n\n```\nconst a = 1;\n```\n\nещё')).toBe(2);
    expect(countWords('<em>слово</em> и <br/> другое')).toBe(3);
  });
});

describe('countParagraphs', () => {
  it('counts blocks separated by a blank line', () => {
    expect(countParagraphs('')).toBe(0);
    expect(countParagraphs('первый абзац\n\nвторой абзац\n\nтретий')).toBe(3);
  });

  it('does not count a heading as a paragraph — it names one', () => {
    expect(countParagraphs('# Молитва Иависа\n\nОн воззвал к Богу.')).toBe(1);
    expect(countParagraphs('# Один\n## Два\n\nТекст под ними.')).toBe(1);
  });
});

describe('expectedScratchCountCorridor', () => {
  it('promises nothing for an empty note, and at least one with room above it otherwise', () => {
    expect(expectedScratchCountCorridor('')).toEqual({ min: 0, max: 0 });
    expect(expectedScratchCountCorridor('   \n\n  ')).toEqual({ min: 0, max: 0 });
    expect(expectedScratchCountCorridor('одна мысль')).toEqual({ min: 1, max: 2 });
    expect(expectedScratchCountCorridor(note(120))).toEqual({ min: 1, max: 2 });
  });

  it('scales with the note: a short note yields a few, a manuscript yields many', () => {
    expect(expectedScratchCountCorridor(note(800))).toEqual({ min: 2, max: 4 });
    expect(expectedScratchCountCorridor(note(2400))).toEqual({ min: 6, max: 10 });
    // The note the contract was checked against live: ~5,800 words of study text.
    expect(expectedScratchCountCorridor(note(5800))).toEqual({ min: 15, max: 24 });
  });

  it('is monotonic in length', () => {
    let previous = expectedScratchCountCorridor('');
    for (const words of [150, 400, 650, 1400, 3200, 8000]) {
      const next = expectedScratchCountCorridor(note(words));
      expect(next.min).toBeGreaterThanOrEqual(previous.min);
      expect(next.max).toBeGreaterThanOrEqual(previous.max);
      expect(next.max).toBeGreaterThan(next.min);
      previous = next;
    }
  });

  it('does not shrink the promise for a language that spends more characters per word', () => {
    // One thought, said in Russian (long words) and in English (short ones): the same
    // sentence costs 100 characters in one and 70 in the other, but it is one thought.
    const russian = 'Благословение приходит не от собственного умения, а исключительно от простёртой руки Господней';
    const english = 'A blessing comes not from your own skill but only from the hand of God';
    expect(countWords(russian)).toBe(12);
    expect(countWords(english)).toBe(15);
    expect(expectedScratchCountCorridor(russian)).toEqual(expectedScratchCountCorridor(english));
  });
});

describe('measureNoteForCut', () => {
  it('returns the note in units the reader can check, plus the corridor they justify', () => {
    expect(measureNoteForCut(note(5800, 42))).toEqual({
      words: 5800,
      paragraphs: 42,
      corridor: { min: 15, max: 24 },
    });
  });
});
