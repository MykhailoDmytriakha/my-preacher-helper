import { mergeFields } from '@/data-engine/protocol';
import { applyStroke, decodeBookMarks, encodeBookMarks, marksOnWord, readBookMarks, strokeErases, verseOrder, type BookMarks } from '@/utils/bibleMarks';

const words = (raw: string) => raw.split(/\s+/).filter(Boolean).length;
// Two chapters: 1:1 has four words, 1:2 three, 2:1 two.
const order = verseOrder([['a b c d', 'e f g'], ['h i']], words);

describe('bibleMarks', () => {
  it('paints the words of one verse and keeps the colour', () => {
    const book = applyStroke({}, order, { verse: '1:1', index: 1 }, { verse: '1:1', index: 2 }, { tool: 'marker', color: 'red' }, false);
    expect(book).toEqual({ '1:1': { m: [[1, 2, 'red']] } });
  });

  it('cuts a stroke across verses and chapters at each verse edge, either direction', () => {
    const forward = applyStroke({}, order, { verse: '1:1', index: 2 }, { verse: '2:1', index: 0 }, { tool: 'marker', color: 'blue' }, false);
    const backward = applyStroke({}, order, { verse: '2:1', index: 0 }, { verse: '1:1', index: 2 }, { tool: 'marker', color: 'blue' }, false);
    expect(forward).toEqual({ '1:1': { m: [[2, 3, 'blue']] }, '1:2': { m: [[0, 2, 'blue']] }, '2:1': { m: [[0, 0, 'blue']] } });
    expect(backward).toEqual(forward);
  });

  it('repaints another colour and joins neighbours of the same colour', () => {
    let book: BookMarks = applyStroke({}, order, { verse: '1:1', index: 0 }, { verse: '1:1', index: 3 }, { tool: 'marker', color: 'red' }, false);
    book = applyStroke(book, order, { verse: '1:1', index: 1 }, { verse: '1:1', index: 2 }, { tool: 'marker', color: 'green' }, false);
    expect(book['1:1'].m).toEqual([[0, 0, 'red'], [1, 2, 'green'], [3, 3, 'red']]);
    book = applyStroke(book, order, { verse: '1:1', index: 1 }, { verse: '1:1', index: 2 }, { tool: 'marker', color: 'red' }, false);
    expect(book['1:1'].m).toEqual([[0, 3, 'red']]);
  });

  it('a stroke that starts on the same colour erases it; another colour does not', () => {
    const book = applyStroke({}, order, { verse: '1:2', index: 0 }, { verse: '1:2', index: 2 }, { tool: 'marker', color: 'yellow' }, false);
    expect(strokeErases(book, { verse: '1:2', index: 1 }, { tool: 'marker', color: 'yellow' })).toBe(true);
    expect(strokeErases(book, { verse: '1:2', index: 1 }, { tool: 'marker', color: 'orange' })).toBe(false);
    const erased = applyStroke(book, order, { verse: '1:2', index: 1 }, { verse: '1:2', index: 2 }, { tool: 'marker', color: 'yellow' }, true);
    expect(erased).toEqual({ '1:2': { m: [[0, 0, 'yellow']] } });
  });

  it('keeps the pencil line as its own layer under a colour', () => {
    let book = applyStroke({}, order, { verse: '1:1', index: 0 }, { verse: '1:1', index: 1 }, { tool: 'marker', color: 'orange' }, false);
    book = applyStroke(book, order, { verse: '1:1', index: 1 }, { verse: '1:1', index: 2 }, { tool: 'pencil', color: 'gray' }, false);
    expect(book['1:1']).toEqual({ m: [[0, 1, 'orange']], p: [[1, 2, 'gray']] });
    expect(marksOnWord(book['1:1'], 1)).toEqual({ color: 'orange', pencil: 'gray' });
    expect(strokeErases(book, { verse: '1:1', index: 2 }, { tool: 'pencil', color: 'gray' })).toBe(true);
    expect(strokeErases(book, { verse: '1:1', index: 2 }, { tool: 'pencil', color: 'blue' })).toBe(false);
  });

  it('draws the pencil line in a colour; another colour redraws it', () => {
    let book = applyStroke({}, order, { verse: '1:1', index: 0 }, { verse: '1:1', index: 3 }, { tool: 'pencil', color: 'green' }, false);
    book = applyStroke(book, order, { verse: '1:1', index: 2 }, { verse: '1:1', index: 3 }, { tool: 'pencil', color: 'gray' }, false);
    expect(book['1:1'].p).toEqual([[0, 1, 'green'], [2, 3, 'gray']]);
  });

  it('the eraser takes colour and pencil away and forgets an empty verse', () => {
    let book = applyStroke({}, order, { verse: '1:1', index: 0 }, { verse: '1:1', index: 3 }, { tool: 'marker', color: 'red' }, false);
    book = applyStroke(book, order, { verse: '1:1', index: 0 }, { verse: '1:1', index: 3 }, { tool: 'pencil', color: 'red' }, false);
    book = applyStroke(book, order, { verse: '1:1', index: 0 }, { verse: '1:1', index: 3 }, { tool: 'eraser' }, true);
    expect(book).toEqual({});
  });

  it('reads only well-formed marks from storage', () => {
    const book = readBookMarks({
      '1:1': { m: [[0, 2, 'red'], [3, 1, 'blue'], [4, 5, 'pink']], p: [[1, 1], ['x', 2], [3, 4, 'blue']] },
      'nonsense': { m: [[0, 1, 'red']] },
      '2:1': 'broken',
    });
    // A pencil line saved before the pencil had colours is grey.
    expect(book).toEqual({ '1:1': { m: [[0, 2, 'red']], p: [[1, 1, 'gray'], [3, 4, 'blue']] } });
    expect(readBookMarks(null)).toEqual({});
  });

  it('stores a verse layer as one string of runs and reads it back', () => {
    const book: BookMarks = { '26:4': { m: [[0, 0, 'red'], [3, 3, 'red']], p: [[1, 2, 'blue']] }, '1:1': { p: [[0, 5, 'gray']] } };
    const stored = encodeBookMarks(book);
    expect(stored).toEqual({ v26_4: { m: '0-0-red,3-3-red', p: '1-2-blue' }, v1_1: { p: '0-5-gray' } });
    expect(decodeBookMarks(stored)).toEqual(book);
  });

  it('the same verse changed on two devices is one value to the engine: a question, never two colours on one word', () => {
    const base = encodeBookMarks({ '26:4': { m: [[0, 3, 'red']] } });
    const blue = encodeBookMarks({ '26:4': { m: [[0, 3, 'blue']] } });
    const green = encodeBookMarks({ '26:4': { m: [[0, 3, 'green']] } });
    const sameVerse = mergeFields({ exists: true, value: base }, { exists: true, value: blue }, { exists: true, value: green }, ['verses']);
    expect(sameVerse.conflicts).toHaveLength(1);
    // Different verses, and a verse's marker and pencil, still merge by themselves.
    const pencilHere = encodeBookMarks({ '26:4': { m: [[0, 3, 'red']], p: [[0, 1, 'gray']] } });
    const otherVerse = encodeBookMarks({ '26:4': { m: [[0, 3, 'red']] }, '26:5': { m: [[1, 1, 'orange']] } });
    const merged = mergeFields({ exists: true, value: base }, { exists: true, value: pencilHere }, { exists: true, value: otherVerse }, ['verses']);
    expect(merged.conflicts).toHaveLength(0);
    expect(decodeBookMarks((merged.value as { value: unknown }).value)).toEqual({ '26:4': { m: [[0, 3, 'red']], p: [[0, 1, 'gray']] }, '26:5': { m: [[1, 1, 'orange']] } });
  });

  it('reads only well-formed stored verses, the first list form too', () => {
    expect(decodeBookMarks({ v2_1: { m: '0-1-red,x-1-red,4-2-red,0-0-pink' }, nonsense: { m: '0-0-red' }, v3_1: 'broken', v4_1: { p: ['1-2-blue'] } }))
      .toEqual({ '2:1': { m: [[0, 1, 'red']] }, '4:1': { p: [[1, 2, 'blue']] } });
    expect(decodeBookMarks(undefined)).toEqual({});
  });
});
