'use client';

import React, { createContext, useContext, useMemo } from 'react';

import PointNote from '@/components/PointNote';
import { useStructureWriter } from '@/components/sermon/structureWriter';
import { scratchByOutlineNode } from '@/utils/scratchPlacement';
import { useTranslation } from '@locales/useTranslation';

import type { ScratchNote, SermonOutline } from '@/models/models';
import type { OutlineNoteTarget, SaveSermonNoteText } from '@/utils/sermonNoteText';

const NO_NOTES = new Map<string, ScratchNote[]>();
const PlacedSketchesContext = createContext<Map<string, ScratchNote[]>>(NO_NOTES);

/**
 * Lets every point and sub-point below show the scratch notes filed under it. The outline is the one the
 * screen shows, so a point renamed or moved there still finds its notes.
 */
export function PlacedSketchesProvider({ notes, outline, children }: {
  notes: readonly ScratchNote[] | undefined; outline: SermonOutline | undefined; children: React.ReactNode;
}) {
  const byNode = useMemo(() => (notes?.length ? scratchByOutlineNode(notes, outline) : NO_NOTES), [notes, outline]);
  return <PlacedSketchesContext.Provider value={byNode}>{children}</PlacedSketchesContext.Provider>;
}

/** The node's old one-line reminder, still kept in the point itself, with its own guarded way of saving. */
interface OutlineNote {
  text?: string;
  onChange: (note: string | undefined) => void;
  captureSave?: () => SaveSermonNoteText;
}

/**
 * «О чём здесь сказать» — the scratch notes («наброски») of a point or a sub-point, as reminders with a
 * lightbulb (owner, 2026-11-19: a reminder and a filed scratch note are one thing, pieces, several to a
 * node). The node's old one-line reminder is the first of them; every note added here is a new piece,
 * never glued onto another. A click edits, the × asks and deletes, «+ набросок» adds — the same on the
 * structure page and in the structure editor, and the same notes as on the «Наброски» board.
 */
export function NodeSketches({ node, outlineNote, isReadOnly = false, indentClass, addRevealClass }: {
  node: OutlineNoteTarget;
  outlineNote?: OutlineNote;
  isReadOnly?: boolean;
  indentClass?: string;
  addRevealClass?: string;
}) {
  const { t } = useTranslation();
  const writer = useStructureWriter();
  const notes = useContext(PlacedSketchesContext).get(node.id) ?? [];
  const labels = {
    label: t('scratch.node.label'), placeholder: t('planEditor.note.placeholder'), clear: t('scratch.node.delete'),
    add: t('scratch.node.add'), deleteConfirm: { key: 'scratch.node.deleteConfirm' },
  };
  const canWrite = !isReadOnly && Boolean(writer.addSketch && writer.editSketch && writer.deleteSketch);
  return (
    <>
      {outlineNote?.text?.trim() && (
        <PointNote note={outlineNote.text} onChange={outlineNote.onChange} captureSave={outlineNote.captureSave}
          isReadOnly={isReadOnly} indentClass={indentClass} addRevealClass={addRevealClass} labels={labels} />
      )}
      {notes.map((note) => (
        <div key={note.id} data-testid={`node-sketch-${note.id}`}>
          <PointNote note={note.text} isReadOnly={!canWrite} indentClass={indentClass} addRevealClass={addRevealClass} labels={labels}
            onChange={(text) => { void (text ? writer.editSketch?.(note, text) : writer.deleteSketch?.(note))?.catch(() => undefined); }}
            captureSave={writer.captureSketchEdit && (() => {
              const save = writer.captureSketchEdit!(note);
              // A cleared note is deleted, not left as an empty piece (the guarded text write keeps words only).
              return (text) => (text ? save(text) : writer.deleteSketch?.(note).then(() => undefined));
            })} />
        </div>
      ))}
      {canWrite && (
        // A refused add keeps the field open with the typed words (the save is awaited, not fired and forgotten).
        <PointNote note={undefined} indentClass={indentClass} addRevealClass={addRevealClass} labels={labels}
          onChange={() => undefined}
          captureSave={() => (text) => (text ? writer.addSketch!(node, text).then(() => undefined) : undefined)} />
      )}
    </>
  );
}
