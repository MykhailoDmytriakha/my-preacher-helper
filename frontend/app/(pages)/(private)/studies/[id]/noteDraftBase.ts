import { engineNote, storedReferences } from '@/hooks/useStudyNotesEngine';
import { changedFields } from '@/utils/changedFields';

import type { NoteDraftPayload } from './noteDraft';
import type { DocumentData } from '@/data-engine/types';
import type { ScriptureReference } from '@/models/models';
import type { AppLocale } from '@/utils/appLocale';

/*
 * A NOTE DRAFT IS A FROZEN EDITOR SESSION: the words and the base they were built from — the page's `baselineRef`,
 * the very value its next save sends as `expectedBaseline`. Restoring the draft resumes that session (editor := words,
 * baseline := base), so the ordinary autosave sends only what differs from the base, and the existing baseline check
 * (`useStudyNotesEngine.updateNote`) with the server's field merge decides: accept, merge by field, or ask. Nothing
 * here compares one version with another; it only keeps and restores what the check needs.
 */

/** The base a note draft keeps: the page's baseline as it is at this write, its references as STORED data. */
export function noteDraftBase(baseline: NoteDraftPayload | null): NoteDraftPayload | undefined {
    // The check maps an on-screen reading of old Bible-less references back to the stored list through the reading
    // list itself, in memory; a copy in device storage loses that, so it keeps the stored list instead.
    return baseline ? { ...baseline, scriptureRefs: storedReferences(baseline.scriptureRefs) as ScriptureReference[] } : undefined;
}

const isText = (value: unknown) => value === null || typeof value === 'string';
const isList = (value: unknown) => value === null
    || (Array.isArray(value) && value.every(item => typeof item === 'string' || (item !== null && typeof item === 'object')));

/** A kept base the check can read: the fields the editor owns, each a value or null (unknown). */
function readableBase(kept: unknown): kept is NoteDraftPayload {
    if (!kept || typeof kept !== 'object') return false;
    const base = kept as Record<string, unknown>;
    return ['title', 'content', 'tags', 'scriptureRefs', 'type'].every(field => field in base)
        && isText(base.title) && isText(base.content) && isText(base.type) && isList(base.tags) && isList(base.scriptureRefs);
}

/**
 * The baseline a restored draft resumes from.
 *
 * - A kept base: as it was written. Its stored references are read back as the screens read a note (`engineNote`),
 *   so the restored words differ from it only where the person edited, and the check maps that reading back to the
 *   stored list it compares.
 * - No readable base (a copy written before drafts kept one): what these words were built from is unknown. Every field
 *   the copy would change in the note as stored (`stored`: the row the page shows, never the base of a copy restored
 *   before this one) gets an unknown base (null); the existing check reads an unknown base as changed elsewhere unless
 *   the stored value already is the copy's, so the restore is refused before any command and the existing version
 *   question is asked. Fields the copy leaves as stored keep that value as their base and are not sent.
 */
export function resumedNoteBaseline(kept: unknown, restored: NoteDraftPayload, stored: NoteDraftPayload | null,
    noteId: string, locale: AppLocale): NoteDraftPayload {
    if (readableBase(kept)) {
        if (!Array.isArray(kept.scriptureRefs)) return kept;
        const reading = engineNote({ type: kept.type ?? undefined, scriptureRefs: kept.scriptureRefs } as unknown as DocumentData, noteId, locale).scriptureRefs;
        return { ...kept, scriptureRefs: reading };
    }
    const unknown = Object.keys(changedFields(stored, restored));
    return { ...stored, ...Object.fromEntries(unknown.map(field => [field, null])) } as unknown as NoteDraftPayload;
}
