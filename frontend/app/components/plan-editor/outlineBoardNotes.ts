import { NOTE_POOL_ID, notePointContainerId, noteSubContainerId } from '@/utils/boardDnd';

import type { ScratchLayerProps } from './outlineBoardTypes';
import type { ScratchNote } from '@/models/models';

/** One pass over notes; preserve the caller's pool and placed-note display order. */
export function indexScratchNotes(scratch?: Pick<ScratchLayerProps, 'pool' | 'notesById' | 'placements'>) {
  const containers = new Map<string, ScratchNote[]>();
  if (!scratch) return containers;
  containers.set(NOTE_POOL_ID, scratch.pool);
  for (const note of scratch.notesById.values()) {
    const placement = scratch.placements[note.id];
    if (!placement) continue;
    const id = placement.subPointId ? noteSubContainerId(placement.subPointId) : notePointContainerId(placement.pointId);
    const notes = containers.get(id);
    if (notes) notes.push(note);
    else containers.set(id, [note]);
  }
  return containers;
}
