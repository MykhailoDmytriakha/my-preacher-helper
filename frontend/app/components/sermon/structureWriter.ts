import { createContext, useContext } from 'react';

import type { ScratchNote, SermonOutline, Thought, ThoughtsBySection } from '@/models/models';
import type { OutlineInputSequence } from '@/utils/outlineCapture';
import type { CaptureOutlineNote, OutlineNoteTarget, OutlineTitleOpening, OutlineTitleVersion, SaveSermonNoteText } from '@/utils/sermonNoteText';
import type { StructureSectionId } from '@/utils/structureTags';

/**
 * EVERY WRITE THE STRUCTURE SCREEN MAKES, BEHIND ONE SEAM.
 *
 * The drag-and-drop, AI sorting and thought actions keep their own optimistic screen state;
 * only where a change goes is decided here. The engine writer (useEngineStructureWriter) lays
 * the change over the document's current copy and hands it to the engine, which owns delivery
 * and conflicts; outside its provider every write is refused.
 */
/** A placement action names its own thoughts; omitted scope means an explicit whole-board action. */
export interface StructureWriteOptions {
  thoughtIds?: readonly string[];
  /** An AI preview becomes a durable write only when its selected placement is captured. */
  captureReview?: true;
  /** Assignment and order are captured as one action through the same document update. */
  thoughtUpdates?: readonly { thought: Thought; baseThought: Thought | null }[];
}

export interface OutlinePlacementVersion { generation: string | null; observedRevision: number }
export interface OutlinePointMove { pointId: string; before: SermonOutline; version: OutlinePlacementVersion }

export interface StructureWriter {
  captureNoteEdit?: CaptureOutlineNote;
  /** The outline window may keep showing the structure it opened with while the document refreshes. */
  pinOutlineNoteEditor?(): CaptureOutlineNote;
  /**
   * Scratch notes («наброски») on a point or a sub-point: each one a piece of its own, never glued into
   * the node's old one-line `note`. Editing is bound to what the person saw through `captureSketchEdit`.
   */
  addSketch?(target: OutlineNoteTarget, text: string): Promise<unknown>;
  editSketch?(shown: Pick<ScratchNote, 'id' | 'createdAt' | 'text'>, text: string): Promise<unknown>;
  deleteSketch?(shown: Pick<ScratchNote, 'id' | 'createdAt' | 'text'>): Promise<unknown>;
  captureSketchEdit?(note: ScratchNote): SaveSermonNoteText;
  outlineTitleVersion?(opening: OutlineTitleOpening): OutlineTitleVersion | undefined;
  outlinePlacementVersion?(shown?: SermonOutline): OutlinePlacementVersion | undefined;
  updateStructure(sermonId: string, structure: ThoughtsBySection, baseStructure?: ThoughtsBySection | null, options?: StructureWriteOptions): Promise<unknown>;
  updateThought(sermonId: string, thought: Thought, baseThought: Thought | null): Promise<Thought>;
  deleteThought(sermonId: string, thought: Thought): Promise<void>;
  /** `section`: the column it was added in, where it is placed whatever its tags. */
  createManualThought(sermonId: string, thought: Thought, section?: StructureSectionId): Promise<Thought>;
  updateSermonOutline(sermonId: string, outline: SermonOutline, baseOutline?: SermonOutline | null,
    onCollision?: 'refuse' | 'preferMine', inputSequence?: OutlineInputSequence, pointMove?: OutlinePointMove): Promise<SermonOutline | null>;
}

const noWriter = (): Promise<never> => Promise.reject(new Error('No structure writer: render inside the engine StructureWriterContext.Provider'));

/** Outside its provider a structure view can be drawn, but every write is refused out loud. */
export const StructureWriterContext = createContext<StructureWriter>({
  updateStructure: noWriter, updateThought: noWriter, deleteThought: noWriter, createManualThought: noWriter, updateSermonOutline: noWriter,
});

export function useStructureWriter(): StructureWriter {
  return useContext(StructureWriterContext);
}
