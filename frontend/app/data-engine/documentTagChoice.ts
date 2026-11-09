import { changeTagMembership, documentTagCollection, documentTagConflictName, DOCUMENT_TAG_FIELD, rebaseOptionalPrayerTags, tagField, tagList, tagMembership } from './documentTagMembership';
import { readField, writeField } from './fieldValues';
import { mergeDocumentFields } from './protocol';

import type { SessionCheckpoint } from './session';
import type { ConflictDetail, DocumentData, ResourceSnapshot } from './types';

function tagChoices(basis: ResourceSnapshot, draft: DocumentData | null, stored: ResourceSnapshot | null,
  conflicts: readonly ConflictDetail[]) {
  if (!documentTagCollection(basis.resource.collection) || !basis.value || !draft || !stored?.value
    || !basis.metadata || basis.metadata.generation !== stored.metadata?.generation || !conflicts.length) return undefined;
  const localTags = tagField(draft), storedTags = tagField(stored.value);
  const choices = conflicts.flatMap(({ path }) => {
    const tag = documentTagConflictName(path);
    if (!tag) return [];
    const mine = tagMembership(localTags, tag), saved = tagMembership(storedTags, tag);
    return mine !== undefined && saved !== undefined && mine !== saved ? [{ tag, mine, stored: saved }] : [];
  });
  return choices.length === conflicts.length ? choices : undefined;
}

export function readDocumentTagComparison(checkpoint: SessionCheckpoint) {
  const { confirmed, draft, remoteCandidate, conflicts } = checkpoint;
  const choices = tagChoices(confirmed, draft, remoteCandidate, conflicts);
  if (!choices) return undefined;
  return { choices, identity: JSON.stringify([checkpoint.editGeneration, remoteCandidate?.metadata?.revision, choices]) };
}

function replaceChosenTags(value: DocumentData, choices: NonNullable<ReturnType<typeof tagChoices>>, side: 'mine' | 'stored', collection: string) {
  const tags = choices.reduce((field, choice) => changeTagMembership(field, choice.tag, choice[side]), tagField(value));
  return writeField(value, [DOCUMENT_TAG_FIELD], collection === 'prayerRequests' && tagList(tags.value)?.length === 0 ? { exists: false } : tags);
}

/** Accept exactly the shown stored tags and keep the other fields from that Save. */
export function keepUncontestedDocumentTagFields(basis: ResourceSnapshot, draft: DocumentData | null, stored: ResourceSnapshot | null,
  conflicts: readonly ConflictDetail[]): DocumentData | undefined {
  const choices = tagChoices(basis, draft, stored, conflicts);
  if (!choices || !draft || !stored?.value) return undefined;
  const retained = writeField(replaceChosenTags(draft, choices, 'stored', basis.resource.collection), ['updatedAt'], readField(stored.value, ['updatedAt']));
  const merged = rebaseOptionalPrayerTags(basis.resource.collection, basis.value, retained, stored.value,
    mergeDocumentFields(basis.value, retained, stored.value));
  if (merged.conflicts.length || !merged.value.exists) throw Object.assign(new Error('The shown tag choice changed'), { code: 'decision-changed' });
  return merged.value.value as DocumentData;
}

export function keepExactLocalDocumentTags(checkpoint: SessionCheckpoint, merged: DocumentData | null): DocumentData | null {
  if (!merged) return merged;
  const { confirmed, draft, remoteCandidate, conflicts } = checkpoint;
  const exact = conflicts.filter(({ path }) => documentTagConflictName(path));
  const choices = tagChoices(confirmed, draft, remoteCandidate, exact);
  return choices ? replaceChosenTags(merged, choices, 'mine', confirmed.resource.collection) : merged;
}
