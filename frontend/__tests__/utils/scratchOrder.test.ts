import { moveNoteTo } from '@/utils/scratchOrder';

import type { ScratchNote } from '@/models/models';

const note = (id: string): ScratchNote => ({ id, text: id, createdAt: '2026-09-05T00:00:00.000Z' });
const list = (...ids: string[]) => ids.map(note);
const ids = (notes: ScratchNote[]) => notes.map((n) => n.id);

/**
 * THE BUG THIS GUARDS, IN THE OWNER'S WORDS: "ставлю после самой последней,
 * отпускаю — она становится предпоследней; снизу вверх работает, сверху вниз нет."
 *
 * The index a drop names is counted in the list WITHOUT the lifted note — that
 * is the list the person sees while the note is in the air. Any second correction
 * for "moving down" lands the note one slot short. The demo had that bug; the
 * cases below are the ones it failed.
 */
describe('moveNoteTo — one note, one destination, one index', () => {
  describe('inside one container', () => {
    it('moves the first note after the last one', () => {
      expect(ids(moveNoteTo(list('a', 'b', 'c'), 'a', ['b', 'c'], 2))).toEqual(['b', 'c', 'a']);
    });

    it('moves the last note to the top', () => {
      expect(ids(moveNoteTo(list('a', 'b', 'c'), 'c', ['a', 'b'], 0))).toEqual(['c', 'a', 'b']);
    });

    it('moves the first note between the other two', () => {
      expect(ids(moveNoteTo(list('a', 'b', 'c'), 'a', ['b', 'c'], 1))).toEqual(['b', 'a', 'c']);
    });

    it('returns the same list when the note is dropped where it already is', () => {
      const notes = list('a', 'b', 'c');
      expect(moveNoteTo(notes, 'b', ['a', 'c'], 1)).toBe(notes);
    });
  });

  describe('across containers, with other notes lying between in the flat list', () => {
    // Flat list: x is in the pool, a and b are filed on a point, y is in the pool.
    it('puts a pool note before the first note of a point', () => {
      expect(ids(moveNoteTo(list('x', 'a', 'b', 'y'), 'y', ['a', 'b'], 0))).toEqual(['x', 'y', 'a', 'b']);
    });

    it('puts a pool note after the last note of a point', () => {
      expect(ids(moveNoteTo(list('x', 'a', 'b', 'y'), 'x', ['a', 'b'], 2))).toEqual(['a', 'b', 'x', 'y']);
    });

    it('keeps the other container\'s order when a note leaves it', () => {
      const next = moveNoteTo(list('x', 'a', 'b', 'y'), 'a', ['x', 'y'], 1);
      expect(ids(next)).toEqual(['x', 'a', 'b', 'y'].filter((id) => id !== 'a').flatMap((id) => (id === 'y' ? ['a', 'y'] : [id])));
      expect(ids(next).filter((id) => id === 'b' || id === 'x' || id === 'y')).toEqual(['x', 'b', 'y']);
    });
  });

  describe('edges', () => {
    it('appends to the end of the flat list when the container is empty', () => {
      expect(ids(moveNoteTo(list('a', 'b', 'c'), 'a', [], 0))).toEqual(['b', 'c', 'a']);
    });

    it('clamps an index past the end to "last"', () => {
      expect(ids(moveNoteTo(list('a', 'b', 'c'), 'a', ['b', 'c'], 99))).toEqual(['b', 'c', 'a']);
    });

    it('ignores neighbours that are not in the list, and the moved note itself', () => {
      expect(ids(moveNoteTo(list('a', 'b'), 'a', ['a', 'ghost', 'b'], 1))).toEqual(['b', 'a']);
    });

    it('returns the same list for an unknown note', () => {
      const notes = list('a', 'b');
      expect(moveNoteTo(notes, 'ghost', ['a'], 0)).toBe(notes);
    });

    it('does not mutate its input', () => {
      const notes = list('a', 'b', 'c');
      moveNoteTo(notes, 'a', ['b', 'c'], 2);
      expect(ids(notes)).toEqual(['a', 'b', 'c']);
    });
  });
});
