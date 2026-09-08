import type PointNote from '@/components/PointNote';
import type { ScratchNote } from '@/models/models';
import type React from 'react';

export type DragHandleProps = Record<string, unknown>;

export type ScratchPlacementTarget = { pointId: string; subPointId?: string };

export type ScratchLayerProps = {
  pool: ScratchNote[];
  notesById: Map<string, ScratchNote>;
  placements: Record<string, ScratchPlacementTarget>;
  /** Re-file a note without touching its order — structural remaps and the "back to the pool" button. */
  onPlace: (noteId: string, target: ScratchPlacementTarget | null) => void;
  /**
   * One drop: WHICH container and WHERE among its notes. `neighbourIds` are that
   * container's notes as displayed, without the moved one; `index` counts among them.
   */
  onMove?: (noteId: string, target: ScratchPlacementTarget | null, neighbourIds: string[], index: number) => void;
  renderNote: (
    note: ScratchNote,
    dragHandleProps: DragHandleProps,
    options?: { overlay?: boolean }
  ) => React.ReactNode;
  poolHeader?: React.ReactNode;
  poolEmptyLabel?: string;
  /**
   * Wording for the per-point notes while the scratch layer is on. On this board a
   * point's note is the very slot a placed scratch note lands in, so calling it a
   * "reminder note" here drags the plan-editor vocabulary onto a screen that is
   * about scratch notes. Omitted -> the plan-editor wording.
   */
  noteLabels?: React.ComponentProps<typeof PointNote>['labels'];
};
