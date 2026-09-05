import {
  planNoteCutSlices,
  sectionsText,
  sliceSections,
  splitNoteIntoSections,
  SLICE_WORD_BUDGET,
} from '@/utils/noteSections';

const NOTE = [
  'Вступительный абзац без заголовка.',
  '',
  '## Девять глав одних имён',
  '',
  'Первый абзац раздела.',
  '',
  'Второй абзац раздела.',
  '',
  '### Подзаголовок внутри',
  '',
  'Текст под подзаголовком.',
  '',
  '## Зачем эти списки понадобились',
  '',
  'Ещё текст.',
].join('\n');

describe('splitNoteIntoSections', () => {
  it('keeps the author own lines: preamble first, then a section per heading', () => {
    const sections = splitNoteIntoSections(NOTE);
    expect(sections.map((section) => section.heading)).toEqual([
      '',
      'Девять глав одних имён',
      'Подзаголовок внутри',
      'Зачем эти списки понадобились',
    ]);
    expect(sections[0].text).toBe('Вступительный абзац без заголовка.');
    expect(sections[1].text).toContain('## Девять глав одних имён');
    expect(sections[1].text).toContain('Второй абзац раздела.');
    expect(sections.map((section) => section.index)).toEqual([0, 1, 2, 3]);
  });

  it('a note without headings is still one cuttable section', () => {
    const sections = splitNoteIntoSections('Одна мысль.\n\nВторая мысль.');
    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBe('');
    expect(sections[0].words).toBe(4);
  });

  it('does not mistake a # inside a code fence for a heading', () => {
    const sections = splitNoteIntoSections('Текст.\n\n```\n# not a heading\n```\n\nЕщё текст.');
    expect(sections).toHaveLength(1);
  });

  it('an empty note has no sections', () => {
    expect(splitNoteIntoSections('')).toEqual([]);
    expect(splitNoteIntoSections('   \n\n ')).toEqual([]);
  });
});

describe('sliceSections', () => {
  const sections = splitNoteIntoSections(NOTE);

  it('takes the window [offset, offset + limit) and survives nonsense', () => {
    expect(sliceSections(sections, 1, 2).map((s) => s.index)).toEqual([1, 2]);
    expect(sliceSections(sections, 0, undefined)).toHaveLength(4);
    expect(sliceSections(sections, -5, 0)).toHaveLength(4);
    expect(sliceSections(sections, 99, 2)).toEqual([]);
  });

  it('hands the model the author text of the window, nothing added', () => {
    const text = sectionsText(sliceSections(sections, 3, 1));
    expect(text).toBe('## Зачем эти списки понадобились\n\nЕщё текст.');
  });
});

describe('planNoteCutSlices', () => {
  it('packs sections in reading order without splitting one', () => {
    const plan = planNoteCutSlices([{ words: 1200 }, { words: 1500 }, { words: 900 }, { words: 400 }], 3000);
    expect(plan).toEqual([
      { offset: 0, limit: 2, words: 2700 },
      { offset: 2, limit: 2, words: 1300 },
    ]);
  });

  it('lets a section longer than the budget ride alone rather than cutting an argument', () => {
    const plan = planNoteCutSlices([{ words: 5000 }, { words: 200 }], 3000);
    expect(plan).toEqual([
      { offset: 0, limit: 1, words: 5000 },
      { offset: 1, limit: 1, words: 200 },
    ]);
  });

  it('a short note stays one slice, an empty one has no slices', () => {
    expect(planNoteCutSlices([{ words: 400 }])).toEqual([{ offset: 0, limit: 1, words: 400 }]);
    expect(planNoteCutSlices([])).toEqual([]);
  });

  it('spreads the load instead of leaving a lonely tail slice', () => {
    // Greedy packing to the budget would give 6 + 6 + 1: the last request would pay a
    // whole AI call for a single section.
    const plan = planNoteCutSlices(Array.from({ length: 13 }, () => ({ words: 485 })), SLICE_WORD_BUDGET);
    expect(plan.map((slice) => slice.limit)).toEqual([5, 4, 4]);
  });

  it('the live manuscript — 13 sections, ~6,300 words — is cut well under the wall', () => {
    const sections = Array.from({ length: 13 }, () => ({ words: 485 }));
    const plan = planNoteCutSlices(sections, SLICE_WORD_BUDGET);
    expect(plan).toHaveLength(3);
    expect(plan.every((slice) => slice.words <= SLICE_WORD_BUDGET)).toBe(true);
    expect(plan.reduce((sum, slice) => sum + slice.limit, 0)).toBe(13);
    // Every section belongs to exactly one slice, in reading order.
    expect(plan.map((slice) => slice.offset)).toEqual([0, 5, 9]);
  });
});
