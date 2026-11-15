import { ALIGNMENT_CELL_BUDGET, alignSequences } from '@/utils/alignSequences';

const diff = (a: string, b: string) => alignSequences([...a], [...b], (x, y) => x === y);

it('keeps equal edges and separates changes around an interior match', () => {
  expect(diff('aXbYc', 'aQbRc')).toEqual([
    { oldFrom: 1, oldTo: 2, newFrom: 1, newTo: 2 },
    { oldFrom: 3, oldTo: 4, newFrom: 3, newTo: 4 },
  ]);
});
it('handles empty, equal, insertion, deletion, repeats and reordering', () => {
  expect(diff('', '')).toEqual([]);
  expect(diff('abc', 'abc')).toEqual([]);
  expect(diff('ac', 'abc')).toEqual([{ oldFrom: 1, oldTo: 1, newFrom: 1, newTo: 2 }]);
  expect(diff('abc', 'ac')).toEqual([{ oldFrom: 1, oldTo: 2, newFrom: 1, newTo: 1 }]);
  expect(diff('aaaa', 'aaaaa')).toEqual([{ oldFrom: 4, oldTo: 4, newFrom: 4, newTo: 5 }]);
  expect(diff('abcd', 'acbd')).toEqual([
    { oldFrom: 1, oldTo: 2, newFrom: 1, newTo: 1 },
    { oldFrom: 3, oldTo: 3, newFrom: 2, newTo: 3 },
  ]);
});
it('uses caller equality without depending on item identity', () => {
  expect(alignSequences([{ id: 1 }], [{ id: 1 }], (a, b) => a.id === b.id)).toEqual([]);
});
it('bounds the middle table and preserves equal edges when over budget', () => {
  let comparisons = 0;
  const n = Math.ceil(Math.sqrt(ALIGNMENT_CELL_BUDGET));
  const a = ['edge', ...Array.from({ length: n }, (_, i) => `a${i}`), 'tail'];
  const b = ['edge', ...Array.from({ length: n }, (_, i) => `b${i}`), 'tail'];
  expect(alignSequences(a, b, (x, y) => { comparisons++; return x === y; })).toEqual([
    { oldFrom: 1, oldTo: n + 1, newFrom: 1, newTo: n + 1 },
  ]);
  expect(comparisons).toBe(4);
});
