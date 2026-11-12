import { rebaseAcceptedStudyNoteReferences } from '@/data-engine/react.client';
import { serializeContent } from '@/utils/contentFingerprint';

import { findOpenedReference, hasDuplicateAuthoredReference, type NoteReferenceOpening } from '../noteReferenceEdits';

import type { StudyNoteReferenceReviewRow } from '@/components/studyNoteReferenceComparison';
import type { ActionTime } from '@/data-engine/actionClock';
import type { StudyNoteReferenceAlias } from '@/data-engine/types';
import type { ScriptureReference } from '@/models/models';
import type { NoteReferenceRecovery } from '@/models/studyNoteDraft';
import type { SetStateAction } from 'react';

export interface NoteReferenceEdit {
    reference?: ScriptureReference;
    time?: ActionTime;
    observedRevision?: number;
}

interface NoteReferenceDraft {
    references: ScriptureReference[];
    aliases: ReadonlyMap<string, string>;
    edits: ReadonlyMap<string, NoteReferenceEdit>;
    review?: { recovery: NoteReferenceRecovery; rows: StudyNoteReferenceReviewRow[]; ids: string[] };
}

type NoteReferenceDraftAction =
    | { type: 'edit'; value: SetStateAction<ScriptureReference[]>; time?: ActionTime; observedRevision?: number }
    | { type: 'edit-opening'; opening: NoteReferenceOpening; value?: ScriptureReference; time?: ActionTime; observedRevision?: number }
    | { type: 'adopt'; references: ScriptureReference[] }
    | { type: 'restore'; references: ScriptureReference[]; recovery: NoteReferenceRecovery; observed?: {
        references: ScriptureReference[]; revision?: number; engineRevision?: number; aliases: readonly StudyNoteReferenceAlias[];
    } }
    | { type: 'acknowledge'; submitted: ScriptureReference[]; accepted: ScriptureReference[]; revision?: number; engineRevision?: number; aliases: readonly StudyNoteReferenceAlias[] }
    | { type: 'choose'; side: 'mine' | 'stored'; review: NoteReferenceDraft['review'] };

export const openingReferenceDraft: NoteReferenceDraft = { references: [], aliases: new Map(), edits: new Map() };

function referenceReview(mine: ScriptureReference[], recovery: NoteReferenceRecovery) {
    const local = new Map(mine.map(row => [row.id, row]));
    const accepted = new Map(recovery.stored.map(row => [row.id, row]));
    const field = (row: ScriptureReference | undefined) => row ? { exists: true, value: { ...row } } : { exists: false };
    const ids = [...new Set([...local.keys(), ...accepted.keys()])].filter(id =>
        serializeContent(local.get(id) ?? null) !== serializeContent(accepted.get(id) ?? null));
    const rows = ids.map(id => ({ mine: field(local.get(id)), stored: field(accepted.get(id)) }));
    if (rows.length && local.size === mine.length && accepted.size === recovery.stored.length) return { recovery, rows, ids };
    if (serializeContent(mine) === serializeContent(recovery.stored)) return undefined;
    // Legacy duplicate IDs or competing list order still need an explicit whole-list decision.
    return { recovery, ids: [...new Set([...local.keys(), ...accepted.keys()])], rows: [
        { mine: { exists: true, value: mine.map(row => ({ ...row })) },
            stored: { exists: true, value: recovery.stored.map(row => ({ ...row })) } },
    ] };
}

export function currentNoteReference(state: NoteReferenceDraft, opening: NoteReferenceOpening) {
    const canonical = opening.uniqueId && state.aliases.get(opening.reference.id);
    return findOpenedReference(state.references, canonical
        ? { ...opening, reference: { ...opening.reference, id: canonical } } : opening);
}

/** Keep both scoped versions with the same local input, including input batched with an acknowledgement. */
export function updateNoteReferenceDraft(state: NoteReferenceDraft, action: NoteReferenceDraftAction): NoteReferenceDraft {
    switch (action.type) {
        case 'edit': {
            const references = typeof action.value === 'function' ? action.value(state.references) : action.value;
            if (references === state.references) return state;
            const review = state.review;
            const before = new Map(state.references.map(ref => [ref.id, ref]));
            const after = new Map(references.map(ref => [ref.id, ref]));
            const edits = new Map(state.edits);
            for (const id of new Set([...before.keys(), ...after.keys()])) {
                const opening = before.get(id), reference = after.get(id);
                if (serializeContent(opening ?? null) === serializeContent(reference ?? null)) continue;
                if (action.time || action.observedRevision) edits.set(id, { reference, time: action.time, observedRevision: action.observedRevision });
                else edits.delete(id);
            }
            if (!review) return { ...state, references, edits };
            const independent = (row: ScriptureReference) => !review.ids.includes(row.id);
            const stored = rebaseAcceptedStudyNoteReferences(
                state.references.filter(independent), references.filter(independent), review.recovery.stored, [],
            ).references;
            return { ...state, references, edits, review: referenceReview(references, { ...review.recovery, stored }) };
        }
        case 'edit-opening': {
            const target = currentNoteReference(state, action.opening);
            if (!target || (action.value && hasDuplicateAuthoredReference(state.references, action.value, target))) return state;
            const replacement = action.value && { ...action.value, id: target.id };
            return updateNoteReferenceDraft(state, { type: 'edit', time: action.time, observedRevision: action.observedRevision,
                value: state.references.flatMap(ref => ref === target ? replacement ?? [] : ref) });
        }
        case 'adopt':
            return { ...state, references: action.references, edits: new Map(), review: undefined };
        case 'restore': {
            const { observed, recovery } = action;
            const restored = { references: action.references, aliases: state.aliases, edits: new Map(), review: referenceReview(action.references, recovery) };
            if (!observed || (recovery.acceptedRevision !== undefined
                && (observed.revision === undefined || observed.revision <= recovery.acceptedRevision))) return restored;
            const { references, revision, engineRevision, aliases } = observed;
            return updateNoteReferenceDraft(restored, { type: 'acknowledge', submitted: recovery.accepted,
                accepted: references, revision, engineRevision, aliases });
        }
        case 'acknowledge': {
            const { submitted, accepted, revision, engineRevision, aliases } = action;
            const rebased = rebaseAcceptedStudyNoteReferences(submitted, state.references, accepted, aliases);
            const previous = state.review?.recovery;
            const rebasedStored = previous && rebaseAcceptedStudyNoteReferences(previous.accepted, previous.stored, accepted, aliases);
            const stored = rebasedStored ? (rebasedStored.needsReview ? rebasedStored.storedChoice : rebasedStored.references)
                : rebased.needsReview ? rebased.storedChoice : undefined;
            return {
                references: rebased.references,
                edits: state.edits,
                aliases: new Map([...state.aliases, ...aliases.map(({ from, to }) => [from, to] as const)]),
                review: stored && referenceReview(rebased.references, { accepted, stored, ...(revision !== undefined && { acceptedRevision: revision }), ...(engineRevision !== undefined && { engineRevision }) }),
            };
        }
        case 'choose':
            if (!state.review || state.review !== action.review) return state;
            const edits = new Map(state.edits);
            for (const id of state.review.ids) {
                edits.delete(id);
                for (const [from, to] of state.aliases) if (id === to) edits.delete(from);
                const observedRevision = state.review.recovery.engineRevision;
                if (action.side === 'mine' && observedRevision) {
                    edits.set(id, { observedRevision, reference: state.references.find(ref => ref.id === id) });
                }
            }
            return { ...state, edits, references: action.side === 'stored' ? state.review.recovery.stored : state.references, review: undefined };
    }
}
