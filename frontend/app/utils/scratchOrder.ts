import type { ScratchNote } from '@/models/models';

/**
 * Move one note to a place among the notes of one container.
 *
 * The sermon keeps ONE flat list of scratch notes; what a container (the pool, a
 * point, a sub-point) shows is that list filtered, in that order. So "put this
 * note before that one" is a statement about the flat list: take the note out,
 * put it back right before its new neighbour. Nothing else changes place, so every
 * other container keeps its order untouched.
 *
 * `neighbourIds` — the target container's notes as the person SEES them, without
 * the moved note. `index` — where among them it lands: 0 is first, `length` is
 * last. An empty container has no neighbour to stand next to; the note then goes
 * to the end of the flat list, which is also the end of that container.
 *
 * Returns the same array when nothing would change, so callers can skip a write.
 */
export function moveNoteTo(
  notes: ScratchNote[],
  noteId: string,
  neighbourIds: string[],
  index: number
): ScratchNote[] {
  const moved = notes.find((note) => note.id === noteId);
  if (!moved) return notes;

  const rest = notes.filter((note) => note.id !== noteId);
  const restIndex = new Map(rest.map((note, i) => [note.id, i]));
  const neighbours = neighbourIds.filter((id) => id !== noteId && restIndex.has(id));

  let flatIndex: number;
  if (neighbours.length === 0) {
    flatIndex = rest.length;
  } else {
    const at = Math.max(0, Math.min(index, neighbours.length));
    flatIndex =
      at < neighbours.length
        ? (restIndex.get(neighbours[at]) as number)
        : (restIndex.get(neighbours[neighbours.length - 1]) as number) + 1;
  }

  const next = [...rest];
  next.splice(flatIndex, 0, moved);
  return next.every((note, i) => note === notes[i]) ? notes : next;
}
