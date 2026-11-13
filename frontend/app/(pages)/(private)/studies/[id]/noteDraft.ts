import { serializeContent } from '@/utils/contentFingerprint';

import type { NoteDraftOrigin, NoteDraftPayload } from '@/models/studyNoteDraft';

export type { NoteDraftPayload };

type DraftField = keyof NoteDraftOrigin['fields'];
const editableFields: DraftField[] = ['title', 'content', 'tags', 'scriptureRefs', 'type'];

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
    for (const field of editableFields) keepOpening(fields, field, opening, draft);
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
    if (!draft.origin) return draft;
    const restored = { ...draft, title: opening.title, content: opening.content, tags: opening.tags,
        scriptureRefs: opening.scriptureRefs, type: opening.type };
    for (const field of editableFields) restoreField(restored, field, draft);
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

export function sameNoteDraft({ origin: _left, ...left }: NoteDraftPayload, { origin: _right, ...right }: NoteDraftPayload): boolean {
    return serializeContent(left) === serializeContent(right);
}
