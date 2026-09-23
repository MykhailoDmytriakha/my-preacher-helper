import { createContext, useContext } from 'react';

import { updateSermonOutline } from '@/services/outline.service';
import { updateStructure } from '@/services/structure.service';
import { createManualThought, deleteThought, updateThought } from '@/services/thought.service';

import type { SermonOutline, Thought, ThoughtsBySection } from '@/models/models';

/**
 * EVERY WRITE THE STRUCTURE SCREEN MAKES, BEHIND ONE SEAM.
 *
 * The drag-and-drop, AI sorting and thought actions keep their own optimistic screen state;
 * only where a change goes is decided here. The legacy writer is the services with their
 * open-time baselines. The engine writer (useEngineStructureWriter) lays the same change over
 * the document's current copy and hands it to the engine, which owns delivery and conflicts.
 */
export interface StructureWriter {
  updateStructure(sermonId: string, structure: ThoughtsBySection, baseStructure?: ThoughtsBySection | null): Promise<unknown>;
  updateThought(sermonId: string, thought: Thought, baseThought: Thought | null): Promise<Thought>;
  deleteThought(sermonId: string, thought: Thought): Promise<void>;
  createManualThought(sermonId: string, thought: Thought): Promise<Thought>;
  updateSermonOutline(sermonId: string, outline: SermonOutline, baseOutline?: SermonOutline | null,
    onCollision?: 'refuse' | 'preferMine'): Promise<SermonOutline | null>;
  /** True when a write is already local and durable on return, so debouncing only delays it. */
  immediate: boolean;
}

// Calls go through the imported bindings at call time, so a test's module mock still applies.
export const legacyStructureWriter: StructureWriter = {
  updateStructure: (sermonId, structure, baseStructure) => updateStructure(sermonId, structure, baseStructure),
  updateThought: (sermonId, thought, baseThought) => updateThought(sermonId, thought, baseThought),
  deleteThought: (sermonId, thought) => deleteThought(sermonId, thought),
  createManualThought: (sermonId, thought) => createManualThought(sermonId, thought),
  updateSermonOutline: (sermonId, outline, baseOutline, onCollision) => updateSermonOutline(sermonId, outline, baseOutline, onCollision),
  immediate: false,
};

export const StructureWriterContext = createContext<StructureWriter>(legacyStructureWriter);

export function useStructureWriter(): StructureWriter {
  return useContext(StructureWriterContext);
}
