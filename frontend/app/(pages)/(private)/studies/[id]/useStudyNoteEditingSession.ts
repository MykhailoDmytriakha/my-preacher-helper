'use client';

import { useMemo, useRef } from 'react';

import { captureStudyNoteReferenceEdit, captureTagIntents, useDataDocument } from '@/data-engine/react.client';
import { engineNote, studyNoteCreationValue } from '@/hooks/useStudyNotesEngine';
import { serializeContent } from '@/utils/contentFingerprint';
import { sameScriptureReference } from '@/utils/scriptureReferenceNumbering';
import { isOrdinaryStudyNote } from '@/utils/studyNoteType';

import type { ActionTime } from '@/data-engine/actionClock';
import type { DocumentUpdateOptions } from '@/data-engine/react.client';
import type { DocumentData } from '@/data-engine/types';
import type { ScriptureReference, StudyNote } from '@/models/models';
import type { AppLocale } from '@/utils/appLocale';

export function useStudyNoteEditingSession({ uid, noteId, isNew, creationId, existingNote, locale, captureActionTime, initialFields }: {
    uid: string | undefined;
    noteId: string;
    isNew: boolean;
    creationId: string;
    existingNote: StudyNote | undefined;
    locale: AppLocale;
    captureActionTime?: () => ActionTime | undefined;
    initialFields: () => Pick<StudyNote, 'type' | 'recordingSourceIds' | 'dictationSourceIds'>;
}) {
    const reserved = useRef<string | null>(null);
    const openedNote = useRef(false);
    if (uid && isNew && !reserved.current) reserved.current = creationId;
    if (existingNote && isOrdinaryStudyNote(existingNote)) openedNote.current = true;
    const create = reserved.current !== null;
    const id = reserved.current ?? noteId;
    const active = Boolean(uid && (create || openedNote.current));
    const document = useDataDocument(active ? { collection: 'studyNotes', id } : null, { slot: 'study-note', create });
    const projected = useMemo(() => document.data && isOrdinaryStudyNote(document.data)
        ? engineNote(document.data, id, locale) : null, [document.data, id, locale]);

    const stage = (update: (live: DocumentData) => DocumentData, options?: DocumentUpdateOptions, canCreate = true) => {
        if (!active || !uid || !document.state) return Promise.resolve();
        return document.update(value => {
            if (!value && (!create || document.confirmed?.metadata || !canCreate)) return value;
            const base = value ?? studyNoteCreationValue({
                userId: uid, title: '', content: '', tags: [], scriptureRefs: [],
                materialIds: [], relatedSermonIds: [], ...initialFields(),
            }, new Date().toISOString());
            if (!isOrdinaryStudyNote(base)) return value;
            return update(base);
        }, create ? { ...options, blankBeforeCreation: draft => !hasAuthoredNote(draft) } : options);
    };
    const changeReferences = (edit: (shown: ScriptureReference[]) => ScriptureReference[]) => {
        const shown = projected?.scriptureRefs ?? [];
        const changed = referenceEdits(shown, edit(shown));
        if (!changed.size) return Promise.resolve();
        const apply = (value: DocumentData) => {
            const refs = (value.scriptureRefs ?? []) as unknown as ScriptureReference[];
            return { ...value, scriptureRefs: applyReferenceEdits(refs, changed) as unknown as DocumentData['scriptureRefs'] };
        };
        const basis = document.confirmed?.metadata;
        const opened = document.data;
        if (!active || !basis || !opened) return stage(apply);
        const shownChange = captureStudyNoteReferenceEdit(opened, apply(opened));
        if (!shownChange) return Promise.resolve();
        const time = captureActionTime?.();
        const observedRevisions = Object.fromEntries([...changed.keys()].map(id => [id, basis.revision]));
        const times = time && Object.fromEntries([...changed.keys()].map(id => [id, time]));
        return document.commit(current => current ? apply(current) : current, {
            kind: 'study-note-references', referenceEvidence: { shownChange, observedRevisions, ...(times && { times }) },
        });
    };
    const changeTags = (edit: (shown: string[]) => string[]) => {
        const shown = projected?.tags ?? [], requested = edit(shown);
        const removed = new Set(shown.filter(tag => !requested.includes(tag)));
        const added = requested.filter(tag => !shown.includes(tag));
        if (!removed.size && !added.length) return Promise.resolve();
        const apply = (value: DocumentData) => ({
            ...value, tags: [...new Set([...((value.tags ?? []) as string[]).filter(tag => !removed.has(tag)), ...added])],
        });
        const basis = document.confirmed?.metadata;
        const intent = basis && captureTagIntents(shown, requested, basis, captureActionTime?.() ?? null);
        if (!active || !intent) return stage(apply);
        return document.commit(current => current ? apply(current) : current, { kind: 'document-tags', tagMembership: intent });
    };
    return { active, id, document, projected, stage, changeReferences, changeTags };
}

/** An unstarted note or an audio source on its own is not a note to create. */
function hasAuthoredNote(value: DocumentData): boolean {
    return (typeof value.title === 'string' && value.title.trim().length > 0)
        || (typeof value.content === 'string' && value.content.trim().length > 0)
        || (Array.isArray(value.tags) && value.tags.length > 0)
        || (Array.isArray(value.scriptureRefs) && value.scriptureRefs.length > 0);
}

function referenceEdits(shown: ScriptureReference[], draft: ScriptureReference[]): Map<string, ScriptureReference | null> {
    const before = new Map(shown.map(ref => [ref.id, ref]));
    const after = new Map(draft.map(ref => [ref.id, ref]));
    return new Map([...new Set([...before.keys(), ...after.keys()])].flatMap(id => {
        const next = after.get(id) ?? null;
        return serializeContent(before.get(id) ?? null) === serializeContent(next) ? [] : [[id, next]];
    }));
}

function applyReferenceEdits(live: ScriptureReference[], changes: ReadonlyMap<string, ScriptureReference | null>): ScriptureReference[] {
    const surviving = new Map(live.map(ref => [ref.id, ref]));
    for (const [id, edit] of changes) {
        if (!edit) surviving.delete(id);
        else if (surviving.has(id) || ![...surviving.values()].some(ref => sameScriptureReference(ref, edit))) surviving.set(id, edit);
    }
    return [...surviving.values()];
}
