import {
  MAX_DEPTH,
  buildPoints,
  descendantsOf,
  flattenPoints,
  getProjection,
  withoutDescendantsOf,
} from '@/utils/outlineFlatten';

import type { OutlinePoint } from '@/models/models';

const points = (): OutlinePoint[] => [
  { id: 'a', text: 'Point A' },
  {
    id: 'b',
    text: 'Point B',
    subPoints: [
      { id: 'b2', text: 'Second child', position: 1 },
      { id: 'b1', text: 'First child', position: 0 },
    ],
  },
  { id: 'c', text: 'Point C' },
];

describe('outlineFlatten', () => {
  describe('flatten / build round trip', () => {
    it('lays the plan out in reading order with depth and parent', () => {
      expect(flattenPoints(points()).map((r) => [r.id, r.depth, r.parentId])).toEqual([
        ['a', 0, null],
        ['b', 0, null],
        ['b1', 1, 'b'],
        ['b2', 1, 'b'],
        ['c', 0, null],
      ]);
    });

    it('rebuilds the same plan it flattened', () => {
      const rebuilt = buildPoints(flattenPoints(points()));
      expect(rebuilt.map((p) => p.id)).toEqual(['a', 'b', 'c']);
      expect(rebuilt[1].subPoints?.map((s) => s.text)).toEqual(['First child', 'Second child']);
      // Positions are renumbered from the order, so a sort can never disagree with
      // what the person sees.
      expect(rebuilt[1].subPoints?.map((s) => s.position)).toEqual([0, 1]);
    });

    it('keeps notes on both levels', () => {
      const withNotes: OutlinePoint[] = [
        { id: 'a', text: 'A', note: 'point note', subPoints: [{ id: 's', text: 'S', position: 0, note: 'sub note' }] },
      ];
      const rebuilt = buildPoints(flattenPoints(withNotes));
      expect(rebuilt[0].note).toBe('point note');
      expect(rebuilt[0].subPoints?.[0].note).toBe('sub note');
    });

    it('promotes a leading orphan instead of dropping it', () => {
      // A row at depth 1 with nothing above it cannot be a child of anything; the
      // alternative to promoting it is losing the text.
      const rebuilt = buildPoints([{ id: 'x', text: 'Orphan', depth: 1, parentId: 'gone' }]);
      expect(rebuilt).toEqual([{ id: 'x', text: 'Orphan' }]);
    });
  });

  describe('getProjection — where the row would land right now', () => {
    const rows = flattenPoints(points());
    const INDENT = 32;

    it('stays at top level when the pointer has not travelled sideways', () => {
      expect(getProjection(rows, 'c', 'a', 0, INDENT)).toEqual({ depth: 0, parentId: null });
    });

    it('nests under the row above once the pointer moves one indent right', () => {
      // Dragging C onto the slot after A, pushed right: A becomes its parent.
      expect(getProjection(rows, 'c', 'b', INDENT, INDENT)).toEqual({ depth: 1, parentId: 'a' });
    });

    it('never goes deeper than the plan allows, however far right you pull', () => {
      // Five indents of travel, two levels of plan: the answer is the deepest the
      // plan HAS, and the depth itself is checked — an earlier version returned a
      // hard-coded 1 here and passed this test with the clamps removed.
      const projection = getProjection(rows, 'c', 'b', INDENT * 5, INDENT);
      expect(projection).toEqual({ depth: 1, parentId: 'a' });
      expect(projection?.depth).toBeLessThanOrEqual(MAX_DEPTH);
    });

    it('cannot nest at the very top — there is nothing above to nest under', () => {
      expect(getProjection(rows, 'c', 'a', INDENT * 3, INDENT)).toEqual({ depth: 0, parentId: null });
    });

    it('joins the same parent when landing between two children', () => {
      expect(getProjection(rows, 'c', 'b2', INDENT, INDENT)).toEqual({ depth: 1, parentId: 'b' });
    });

    it('refuses to go shallower than the row below, which would orphan it', () => {
      // Landing right before a depth-1 row while pulling left: staying at depth 1
      // is the only choice that leaves the next row with a parent.
      expect(getProjection(rows, 'c', 'b1', -INDENT * 3, INDENT)?.depth).toBe(1);
    });

    it('returns nothing when either row is unknown', () => {
      expect(getProjection(rows, 'ghost', 'a', 0, INDENT)).toBeNull();
      expect(getProjection(rows, 'a', 'ghost', 0, INDENT)).toBeNull();
    });
  });

  describe('a dragged point carries its children', () => {
    it('hides and lists the descendants of a row', () => {
      const rows = flattenPoints(points());
      expect(withoutDescendantsOf(rows, 'b').map((r) => r.id)).toEqual(['a', 'b', 'c']);
      expect(descendantsOf(rows, 'b').map((r) => r.id)).toEqual(['b1', 'b2']);
    });
  });
});
