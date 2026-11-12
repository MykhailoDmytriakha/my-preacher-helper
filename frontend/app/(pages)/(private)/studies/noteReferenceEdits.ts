import { serializeContent } from '@/utils/contentFingerprint';
import { sameScriptureReference } from '@/utils/scriptureReferenceNumbering';

import type { ScriptureReference } from '@/models/models';

type ReferenceInput = Omit<ScriptureReference, 'id'>;

export type NoteReferenceOpening = { reference: ScriptureReference; uniqueId: boolean };

export function findOpenedReference(references: ScriptureReference[], opening: NoteReferenceOpening): ScriptureReference | undefined {
    const { reference } = opening;
    if (references.includes(reference)) return reference;
    if (!opening.uniqueId) return undefined;
    const matches = references.filter(ref => ref.id === reference.id);
    if (matches.length === 1 && serializeContent(matches[0]) === serializeContent(reference)) return matches[0];
    return undefined;
}

/** An explicit choice can keep the same passage in two different Bibles. */
export function sameAuthoredReference(left: ReferenceInput, right: ReferenceInput): boolean {
    return left.bible === right.bible && sameScriptureReference(left, right, left.bible);
}

export function hasDuplicateAuthoredReference(references: ScriptureReference[], candidate: ReferenceInput, opening?: ScriptureReference): boolean {
    return references.some(ref => ref !== opening && sameAuthoredReference(ref, candidate));
}

function hasSuggestedReference(references: readonly ScriptureReference[], suggestion: ScriptureReference): boolean {
    return references.some(ref => ref.bible === suggestion.bible
        ? sameAuthoredReference(ref, suggestion) : sameScriptureReference(ref, suggestion));
}

/** Preview and save agree on which proposed places add to the note. */
export function suggestedReferenceDiff(references: readonly ScriptureReference[], suggestions: readonly ScriptureReference[]) {
    const added: ScriptureReference[] = [];
    const kept: ScriptureReference[] = [];
    for (const suggestion of suggestions) {
        const group = hasSuggestedReference(references, suggestion) ? kept : added;
        if (!hasSuggestedReference(group, suggestion)) group.push(suggestion);
    }
    return { added, kept };
}

/** Preserve the person's existing reference, written Bible and quote. */
export function appendSuggestedReferences(references: ScriptureReference[], suggestions: ScriptureReference[]): ScriptureReference[] {
    const { added } = suggestedReferenceDiff(references, suggestions);
    return added.length ? [...references, ...added] : references;
}
