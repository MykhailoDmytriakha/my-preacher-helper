import { isValidRecoveryPatch } from '@/data-engine/react.client';
import { serializeContent } from '@/utils/contentFingerprint';
import { isOrdinaryStudyNoteType } from '@/utils/studyNoteType';

import type { DocumentData } from '@/data-engine/types';
import type { NoteDraftOrigin, NoteDraftPayload } from '@/models/studyNoteDraft';
import type { StaleWriteError } from '@/services/conflictSafeUpdate.client';

export type { NoteDraftPayload };

type DraftField = keyof NoteDraftOrigin['fields'];
export const editableNoteDraftFields: readonly DraftField[] = ['title', 'content', 'tags', 'scriptureRefs', 'type'];

function keepOpening<Field extends DraftField>(fields: NoteDraftOrigin['fields'], field: Field,
    opening: NoteDraftPayload, draft: NoteDraftPayload): void {
    if (opening[field] !== draft[field] && serializeContent(opening[field]) !== serializeContent(draft[field])) {
        fields[field] = opening[field];
    }
}

/** Keep the exact ancestor of the fields that need recovery. Unchanged fields stay with the server copy. */
export function noteDraftOrigin(opening: NoteDraftPayload, draft: NoteDraftPayload,
    title?: NoteDraftOrigin['title'], type?: NoteDraftOrigin['type']): NoteDraftOrigin | undefined {
    const fields: NoteDraftOrigin['fields'] = {};
    for (const field of editableNoteDraftFields) keepOpening(fields, field, opening, draft);
    // A return to a confirmed value can still follow a different, queued local action.
    if (title?.seen.requestId && title.seen.title !== draft.title) fields.title ??= opening.title;
    if (type?.seen.requestId && type.seen.type !== draft.type) fields.type ??= opening.type;
    if (!Object.keys(fields).length) return undefined;
    return { fields, ...(fields.title !== undefined && title && { title }), ...(fields.type !== undefined && type && { type }) };
}

function restoreField<Field extends DraftField>(restored: NoteDraftPayload, field: Field, draft: NoteDraftPayload): void {
    if (draft.origin?.fields[field] !== undefined) restored[field] = draft[field];
}

/** Use the currently stored values for fields this copy did not edit. Legacy copies stay explicitly selectable. */
export function restoreNoteDraft(draft: NoteDraftPayload, opening: NoteDraftPayload): NoteDraftPayload {
    if (!draft.origin || draft.reviewLegacyFields) return draft;
    const restored = { ...draft, title: opening.title, content: opening.content, tags: opening.tags,
        scriptureRefs: opening.scriptureRefs, type: opening.type };
    for (const field of editableNoteDraftFields) restoreField(restored, field, draft);
    if (draft.referenceRecovery) restored.scriptureRefs = draft.scriptureRefs;
    return restored;
}

/** The editor holds a composed body before publishing it as the page's current value. */
export function holdNoteDraftText(draft: NoteDraftPayload, content: string, opening: string | undefined): NoteDraftPayload {
    const { origin } = draft;
    if (opening === undefined) return { ...draft, content };
    const fields = { ...origin?.fields, content: origin?.fields.content ?? opening };
    return { ...draft, content, origin: { ...origin, fields } };
}

/** Equal displayed words do not prove the device's independent action was delivered. */
export function hasUnsubmittedNoteField(draft: NoteDraftPayload): boolean {
    return Boolean(draft.origin?.title || draft.origin?.type);
}

export function differingNoteDraftFields(draft: NoteDraftPayload, stored: NoteDraftPayload): DraftField[] {
    return editableNoteDraftFields.filter(field => serializeContent(draft[field]) !== serializeContent(stored[field]));
}

type NoteDraftFieldChoice = {
    [Field in DraftField]: { field: Field; mine: NoteDraftPayload[Field]; stored: NoteDraftPayload[Field] }
}[DraftField];

/** Only show choices with an exact stored value that can become the next editing basis. */
export function noteDraftFieldChoice(refusal: StaleWriteError, draft: NoteDraftPayload): NoteDraftFieldChoice | undefined {
    const fields = refusal.conflictingFields ?? [];
    const saved = refusal.serverValues ?? {};
    for (const field of editableNoteDraftFields) {
        if (!fields.includes(field)) continue;
        const stored = saved[field];
        if (field === 'title' && (typeof stored === 'string' || stored === null) && draft.title !== (stored ?? '')) {
            return { field, mine: draft.title, stored: stored ?? '' };
        }
        if (field === 'content' && typeof stored === 'string' && draft.content !== stored) {
            return { field, mine: draft.content, stored };
        }
        if (field === 'type' && isOrdinaryStudyNoteType(draft.type) && isOrdinaryStudyNoteType(stored) && draft.type !== stored) {
            return { field, mine: draft.type, stored };
        }
        if ((field === 'tags' || field === 'scriptureRefs') && Array.isArray(stored)
            && isValidRecoveryPatch('studyNotes', { [field]: stored } as DocumentData)
            && serializeContent(stored) !== serializeContent(draft[field])) {
            return field === 'tags'
                ? { field, mine: draft.tags, stored: stored as NoteDraftPayload['tags'] }
                : { field, mine: draft.scriptureRefs, stored: stored as NoteDraftPayload['scriptureRefs'] };
        }
    }
}

export function sameNoteDraft(left: NoteDraftPayload, right: NoteDraftPayload): boolean {
    const display = ({ origin: _origin, reviewLegacyFields: _review, targetGeneration: _generation, ...value }: NoteDraftPayload) => value;
    return serializeContent(display(left)) === serializeContent(display(right));
}
