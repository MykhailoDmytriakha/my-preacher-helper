import { createContext, useContext } from 'react';

import type { SermonOutline, Thought, ThoughtsBySection } from '@/models/models';

/**
 * EVERY WRITE THE STRUCTURE SCREEN MAKES, BEHIND ONE SEAM.
 *
 * The drag-and-drop, AI sorting and thought actions keep their own optimistic screen state;
 * only where a change goes is decided here. The engine writer (useEngineStructureWriter) lays
 * the change over the document's current copy and hands it to the engine, which owns delivery
 * and conflicts; outside its provider every write is refused.
 */
export interface StructureWriter {
  updateStructure(sermonId: string, structure: ThoughtsBySection, baseStructure?: ThoughtsBySection | null): Promise<unknown>;
  updateThought(sermonId: string, thought: Thought, baseThought: Thought | null): Promise<Thought>;
  deleteThought(sermonId: string, thought: Thought): Promise<void>;
  createManualThought(sermonId: string, thought: Thought): Promise<Thought>;
  updateSermonOutline(sermonId: string, outline: SermonOutline, baseOutline?: SermonOutline | null,
    onCollision?: 'refuse' | 'preferMine'): Promise<SermonOutline | null>;
}

const noWriter = (): Promise<never> => Promise.reject(new Error('No structure writer: render inside the engine StructureWriterContext.Provider'));

/** Outside its provider a structure view can be drawn, but every write is refused out loud. */
export const StructureWriterContext = createContext<StructureWriter>({
  updateStructure: noWriter, updateThought: noWriter, deleteThought: noWriter, createManualThought: noWriter, updateSermonOutline: noWriter,
});

export function useStructureWriter(): StructureWriter {
  return useContext(StructureWriterContext);
}
