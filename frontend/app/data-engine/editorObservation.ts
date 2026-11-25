import { sameAnalysisFrame } from './analysisReshapeFields';
import { observedAutosaveFieldsMatch } from './documentFieldAction';
import { rebaseOptionalPrayerTags } from './documentTagMembership';
import { groupFlowCopySources, groupFlowRetirementSources } from './groupFlowTopology';
import { mergeGroupFlowRebase } from './groupStepPlacement';
import { diffFields, mergeDocumentAfterAcknowledgement } from './protocol';
import { validateResourceDocument } from './resourceSchemas';
import { observedRowFieldsMatch } from './rowFieldAutosave';
import { preservesSermonLinks } from './sermonIntegrity';
import { isSermonTextRoot, sermonTextChanges } from './sermonTextOpenings';

import type { SessionCheckpoint } from './session';
import type { DocumentData, ResourceSnapshot } from './types';

function comparable(checkpoint: SessionCheckpoint, incoming: ResourceSnapshot): boolean {
  const { confirmed } = checkpoint;
  return Boolean(confirmed.resource.collection === incoming.resource.collection && confirmed.resource.id === incoming.resource.id
    && confirmed.metadata && incoming.metadata
    && !confirmed.metadata.deleted && !incoming.metadata.deleted
    && confirmed.metadata.generation === incoming.metadata.generation && confirmed.metadata.revision < incoming.metadata.revision
    && !checkpoint.conflicts.length && !checkpoint.privateFieldReview && !checkpoint.groupTextReview && !checkpoint.groupMeetingReview
    && !checkpoint.unreadableScalarProof?.length && !checkpoint.unreadableRowProofs?.length && !checkpoint.unreadableExegeticalProofs?.length
    && !checkpoint.exegeticalPointDrafts && !checkpoint.sermonTextRetry && !checkpoint.accountPreferenceRetry && !checkpoint.sourceNoteLinkRetry
    && !checkpoint.serviceOrderPlacementRetry && !checkpoint.serviceOrderStepPlacementRetry && !checkpoint.serviceOrderPlacementComparison
    && !checkpoint.outlinePointPlacementRetry && !checkpoint.groupFlowStepPlacementRetry && !checkpoint.councilTopicPlacementRetry);
}

function mergeObservedDraft(base: DocumentData, draft: DocumentData,
  incoming: ResourceSnapshot & { value: DocumentData }): DocumentData | null {
  const collection = incoming.resource.collection;
  const merged = collection === 'groups' ? mergeGroupFlowRebase(base, draft, incoming.value)
    : rebaseOptionalPrayerTags(collection, base, draft, incoming.value, mergeDocumentAfterAcknowledgement(base, draft, incoming));
  if (!merged.value.exists || merged.conflicts.length) return null;
  const value = merged.value.value as DocumentData;
  const changedFields = diffFields(incoming.value, value).map(({ path }) => path[0]);
  if (!changedFields.length) return value;
  try {
    validateResourceDocument(collection, value, { kind: 'update', previous: incoming.value, changedFields });
  } catch {
    return null;
  }
  return collection !== 'sermons' || preservesSermonLinks(incoming.value, value) ? value : null;
}

function needsOriginalOpening(checkpoint: SessionCheckpoint, incoming: ResourceSnapshot, draft: DocumentData): boolean {
  const { resource, value } = incoming;
  // These commands use the document revision as their opening. An independent read cannot
  // advance that revision on behalf of words or a frame authored against an earlier copy.
  if (resource.collection === 'sermons') {
    const changes = diffFields(value ?? {}, draft);
    return changes.some(change => {
      const root = change.path[0];
      if (!isSermonTextRoot(root)) return false;
      if (root === 'planText') return !checkpoint.planCellDrafts || sermonTextChanges([change]).some(({ path, after }) => {
        const proof = checkpoint.planCellDrafts?.[path[1]];
        return !after.exists || !proof || proof.text !== after.value || proof.generation !== incoming.metadata?.generation;
      });
      return root !== 'preachDates' || sermonTextChanges([change]).length > 0;
    });
  }
  return resource.collection === 'studyNotes' && value?.type === 'analysis' && draft.type === 'analysis'
    && !sameAnalysisFrame(value, draft);
}

/** An unsent draft can take an independent update without changing the opening of its remaining work. */
export function mergeUnsentObservation(checkpoint: SessionCheckpoint, incoming: ResourceSnapshot): DocumentData | null {
  const { confirmed, draft: local } = checkpoint;
  if (confirmed.resource.collection === 'groups' && confirmed.value && local
    && (groupFlowCopySources(confirmed.value, local).length || groupFlowRetirementSources(confirmed.value, local).length)) return null;
  const merged = compatibleObservation(checkpoint, incoming);
  return merged && !needsOriginalOpening(checkpoint, incoming, merged) ? merged : null;
}

/** A read can be compatible with an edit while its write still needs the exact receipt. */
export function compatibleObservation(checkpoint: SessionCheckpoint, incoming: ResourceSnapshot, awaitingOrder = false): DocumentData | null {
  let base = checkpoint.confirmed.value;
  const mine = checkpoint.draft;
  if (!base || !mine || !incoming.value || !comparable(checkpoint, incoming)) return null;
  const pending = Object.values(checkpoint.pending).sort((a, b) => a.generation - b.generation);
  let stored = { ...incoming, value: incoming.value };
  for (const request of pending) {
    if (!request.value || request.borrowedManualScope || request.outlinePointPlacement || request.groupFlowStepPlacement
      || request.councilTopicPlacement || request.commentPlaceAction) return null;
    const projected = mergeObservedDraft(base, request.value, stored);
    if (!projected) return null;
    base = request.value;
    stored = { ...stored, value: projected };
  }
  const draft = mergeObservedDraft(base, mine, stored);
  return draft && observedAutosaveFieldsMatch(checkpoint, draft, awaitingOrder) && observedRowFieldsMatch(checkpoint, incoming.value, draft, awaitingOrder)
    ? draft : null;
}
