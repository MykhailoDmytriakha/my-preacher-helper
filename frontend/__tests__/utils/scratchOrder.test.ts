import { reorderWithinGroup } from '@/utils/scratchOrder';

import type { ScratchNote } from '@/models/models';

/**
 * The owner's report: "наброски не могу поменять местами внутри подпункта."
 *
 * Two notes filed on the same point, and no way to say which comes first. Their
 * order is the order of the sermon's flat note list, so the swap has to happen
 * there — while leaving every note that belongs to a DIFFERENT point exactly
 * where it was, even when one of them sits between the two being swapped.
 */
const notes = (...ids: string[]): ScratchNote[] =>
  ids.map((id) => ({ id, text: id, createdAt: '2026-08-15T00:00:00.000Z' }));

const ids = (list: ScratchNote[]) => list.map((n) => n.id);

describe('reorderWithinGroup', () => {
  it('swaps two neighbours filed on the same point', () => {
    const list = notes('a', 'b');
    expect(ids(reorderWithinGroup(list, ['a', 'b'], 'b', 0))).toEqual(['b', 'a']);
  });

  it('leaves notes belonging to other points untouched, even in between', () => {
    // 'x' is filed elsewhere and simply happens to sit between the two. Its
    // position in the list must survive the swap.
    const list = notes('a', 'x', 'b');
    expect(ids(reorderWithinGroup(list, ['a', 'b'], 'b', 0))).toEqual(['b', 'x', 'a']);
  });

  it('accounts for the gap the note leaves behind when moving down', () => {
    // Seams are counted with the note still in place: sending the first note to
    // seam 2 lands it after the second note, not past the third.
    const list = notes('a', 'b', 'c');
    expect(ids(reorderWithinGroup(list, ['a', 'b', 'c'], 'a', 2))).toEqual(['b', 'a', 'c']);
  });

  it('can send a note to the end of its group', () => {
    const list = notes('a', 'b', 'c');
    expect(ids(reorderWithinGroup(list, ['a', 'b', 'c'], 'a', 3))).toEqual(['b', 'c', 'a']);
  });

  it('returns the same list when the note would not move', () => {
    const list = notes('a', 'b');
    expect(reorderWithinGroup(list, ['a', 'b'], 'a', 0)).toBe(list);
  });

  it('returns the same list for a note outside the group', () => {
    const list = notes('a', 'b');
    expect(reorderWithinGroup(list, ['a', 'b'], 'ghost', 0)).toBe(list);
  });

  it('never mutates the list it was given', () => {
    const list = notes('a', 'x', 'b');
    const snapshot = ids(list).join();
    reorderWithinGroup(list, ['a', 'b'], 'b', 0);
    expect(ids(list).join()).toBe(snapshot);
  });
});
