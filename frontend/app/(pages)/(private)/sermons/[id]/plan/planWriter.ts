import { createContext, useContext } from 'react';

import { updateSermonOutline } from '@/services/outline.service';
import { savePlanModeViaClient, savePlanTextViaClient } from '@/services/sermons.client';
import { updateThought } from '@/services/thought.service';

import type { SermonOutline, Thought } from '@/models/models';

export type PlanMode = 'manual' | 'ai' | 'note';
export interface PlanTextContext { userId?: string; baselineByNodeId?: Record<string, string | null> }

/**
 * EVERY WRITE THE PLAN SCREENS MAKE, BEHIND ONE SEAM — the same arrangement as the structure
 * board (structure/structureWriter.ts). Legacy: the client writers with their per-cell guard.
 * Engine: useEnginePlanWriter, which keeps the same per-cell rule and the same StaleWriteError.
 */
export interface PlanWriter {
  savePlanText(sermonId: string, changedText: Record<string, string>, removedNodeIds?: string[], context?: PlanTextContext): Promise<void>;
  savePlanMode(sermonId: string, mode: PlanMode): Promise<void>;
  updateThought(sermonId: string, thought: Thought, baseThought: Thought | null): Promise<Thought>;
  updateSermonOutline(sermonId: string, outline: SermonOutline, baseOutline?: SermonOutline | null,
    onCollision?: 'refuse' | 'preferMine'): Promise<SermonOutline | null>;
}

export const legacyPlanWriter: PlanWriter = {
  savePlanText: (sermonId, changedText, removedNodeIds, context) => savePlanTextViaClient(sermonId, changedText, removedNodeIds, context),
  savePlanMode: (sermonId, mode) => savePlanModeViaClient(sermonId, mode),
  updateThought: (sermonId, thought, baseThought) => updateThought(sermonId, thought, baseThought),
  updateSermonOutline: (sermonId, outline, baseOutline, onCollision) => updateSermonOutline(sermonId, outline, baseOutline, onCollision),
};

export const PlanWriterContext = createContext<PlanWriter>(legacyPlanWriter);

export function usePlanWriter(): PlanWriter {
  return useContext(PlanWriterContext);
}
