import {
  remapAfterNest,
  remapAfterOutdent,
  remapAfterSubPointReparent,
  type PlacementMap,
} from '@/utils/scratchPlacementRemap';

/**
 * The owner's report, in one line: "I attached a note to a plan point, then moved
 * that point — and the note is gone."
 *
 * It was never deleted. Notes are found by the ids in their placement, and a move
 * changes what those ids MEAN: a point that becomes a sub-point keeps its id, but
 * a placement that calls it a point stops matching anything, so nothing renders.
 */
describe('notes follow the row they were pinned to', () => {
  const placements = (): PlacementMap => ({
    'note-on-point': { pointId: 'pt-a' },
    'note-on-child': { pointId: 'pt-a', subPointId: 'sub-1' },
    'note-elsewhere': { pointId: 'pt-z' },
  });

  describe('when a point is nested under another point', () => {
    it('re-files its own note as a note on that sub-point', () => {
      const changes = remapAfterNest(placements(), 'pt-a', 'pt-b', ['sub-1']);

      expect(changes).toContainEqual({
        noteId: 'note-on-point',
        placement: { pointId: 'pt-b', subPointId: 'pt-a' },
      });
    });

    it('carries notes pinned to its children, which moved with it', () => {
      const changes = remapAfterNest(placements(), 'pt-a', 'pt-b', ['sub-1']);

      expect(changes).toContainEqual({
        noteId: 'note-on-child',
        placement: { pointId: 'pt-b', subPointId: 'sub-1' },
      });
    });

    it('leaves notes on untouched rows alone', () => {
      const changes = remapAfterNest(placements(), 'pt-a', 'pt-b', ['sub-1']);
      expect(changes.map((c) => c.noteId)).not.toContain('note-elsewhere');
    });

    it('reports nothing when no note was pinned to the moved row', () => {
      expect(remapAfterNest({ n: { pointId: 'other' } }, 'pt-a', 'pt-b', [])).toEqual([]);
    });
  });

  describe('when a sub-point is promoted to a point', () => {
    it('re-files its notes as notes on the new point', () => {
      const changes = remapAfterOutdent(placements(), 'sub-1', 'pt-a');

      expect(changes).toEqual([
        { noteId: 'note-on-child', placement: { pointId: 'sub-1' } },
      ]);
    });

    it('does not touch the note pinned to the parent itself', () => {
      const changes = remapAfterOutdent(placements(), 'sub-1', 'pt-a');
      expect(changes.map((c) => c.noteId)).not.toContain('note-on-point');
    });
  });

  describe('when a sub-point moves under a different point', () => {
    it('points its notes at the new parent', () => {
      const changes = remapAfterSubPointReparent(placements(), 'sub-1', 'pt-c');

      expect(changes).toEqual([
        { noteId: 'note-on-child', placement: { pointId: 'pt-c', subPointId: 'sub-1' } },
      ]);
    });

    it('says nothing when the parent did not actually change', () => {
      expect(remapAfterSubPointReparent(placements(), 'sub-1', 'pt-a')).toEqual([]);
    });
  });
});
