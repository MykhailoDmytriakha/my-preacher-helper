import type { ScratchNote } from '@/models/models';

/**
 * Reordering notes that share a plan point, without disturbing anyone else.
 *
 * Notes have no per-point position field: what a point shows is simply the notes
 * filed there, in the order they sit in the sermon's one flat list. So "swap
 * these two" is a statement about that list — but only about the slots those two
 * occupy. Everything between them belongs to other points and must not shift.
 *
 * The trick is to treat the group's positions in the list as fixed SLOTS and
 * rearrange only which note sits in which slot. Move the second of two notes
 * above the first and exactly two entries change places; a note filed on another
 * point that happens to live between them in the list does not move at all.
 */
export function reorderWithinGroup(
  notes: ScratchNote[],
  groupIds: string[],
  movedId: string,
  targetIndex: number
): ScratchNote[] {
  const group = new Set(groupIds);
  const slots: number[] = [];
  const order: string[] = [];

  notes.forEach((note, index) => {
    if (!group.has(note.id)) return;
    slots.push(index);
    order.push(note.id);
  });

  const from = order.indexOf(movedId);
  if (from < 0) return notes;

  /*
   * `targetIndex` counts the seams as the person SEES them, with the dragged note
   * still in place. Dropping a note below itself therefore names a slot that is
   * one too far once the note is lifted out — the same correction the plan's own
   * movers make.
   */
  const to = Math.max(0, Math.min(targetIndex > from ? targetIndex - 1 : targetIndex, order.length - 1));
  if (to === from) return notes;

  order.splice(from, 1);
  order.splice(to, 0, movedId);

  const byId = new Map(notes.map((note) => [note.id, note]));
  const next = [...notes];
  slots.forEach((slot, i) => {
    const note = byId.get(order[i]);
    if (note) next[slot] = note;
  });

  return next;
}
