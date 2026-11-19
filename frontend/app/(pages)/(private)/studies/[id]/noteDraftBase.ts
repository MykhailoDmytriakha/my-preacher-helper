import { engineNote, storedReferences } from '@/hooks/useStudyNotesEngine';
import { serializeContent } from '@/utils/contentFingerprint';

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

/** Stored references read as the screens read a note (`engineNote`): the reading maps back to this stored list in the check. */
function readStoredReferences(references: unknown, type: unknown, noteId: string, locale: AppLocale): unknown {
    return Array.isArray(references)
        ? engineNote({ type: type ?? undefined, scriptureRefs: references } as unknown as DocumentData, noteId, locale).scriptureRefs
        : references;
}

/**
 * The baseline after «keep my text» in the note's version question: the version the question was about — what the
 * refused save found stored for every field it compared — becomes what the person's text is built from. The next
 * ordinary save then replaces exactly that version, and the existing check refuses (asks again) if another version was
 * stored since. Fields the refusal did not compare keep the shown base, so what the person left untouched is not sent.
 * The same base goes into every copy of the text, so a page that goes away before the send leaves a copy whose restore
 * replaces that version without asking again.
 */
export function keepMineBaseline(shown: NoteDraftPayload, refused: Record<string, unknown>, noteId: string, locale: AppLocale): NoteDraftPayload {
    const decided = Object.fromEntries(Object.entries(refused).filter(([field]) => field in shown));
    const kept = { ...shown, ...decided } as NoteDraftPayload;
    return 'scriptureRefs' in decided
        ? { ...kept, scriptureRefs: readStoredReferences(decided.scriptureRefs, kept.type, noteId, locale) as NoteDraftPayload['scriptureRefs'] }
        : kept;
}

/**
 * The baseline a restored draft resumes from.
 *
 * - A kept base: as it was written. Its stored references are read back as the screens read a note (`engineNote`),
 *   so the restored words differ from it only where the person edited, and the check maps that reading back to the
 *   stored list it compares.
 * - No readable base (a copy written before drafts kept one): what these words were built from is unknown. Every field
 *   the copy would change gets an unknown base (null); the existing check reads an unknown base as changed elsewhere
 *   unless the stored value already is the copy's, so the restore is refused before any command and the existing version
 *   question is asked. Fields the copy leaves as shown keep the shown base and are not sent.
 */
export function resumedNoteBaseline(kept: unknown, restored: NoteDraftPayload, shown: NoteDraftPayload | null,
    noteId: string, locale: AppLocale): NoteDraftPayload {
    if (readableBase(kept)) {
        if (!Array.isArray(kept.scriptureRefs)) return kept;
        return { ...kept, scriptureRefs: readStoredReferences(kept.scriptureRefs, kept.type, noteId, locale) as NoteDraftPayload['scriptureRefs'] };
    }
    const current: Partial<Record<keyof NoteDraftPayload, unknown>> = shown ?? {};
    const unknown = (Object.keys(restored) as (keyof NoteDraftPayload)[])
        .filter(field => serializeContent(current[field]) !== serializeContent(restored[field]));
    return { ...shown, ...Object.fromEntries(unknown.map(field => [field, null])) } as unknown as NoteDraftPayload;
}
