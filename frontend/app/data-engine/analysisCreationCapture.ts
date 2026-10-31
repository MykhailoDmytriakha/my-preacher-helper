import { analysisCreationScope, planStudyAnalysisCreation } from './analysisCreation';
import { ACTION_SLOT, editorIdentity } from './editorIdentity';
import { equalValues } from './protocol';
import { pinSavedDocument } from './savedDocumentPin';
import { DataSession } from './session';

import type { CaptureTransferProof } from './captureTransfer';
import type { CommitRequest } from './commits';
import type { ResourceRef, ResourceSnapshot } from './types';
import type { BookText } from '@/utils/bibleText';

export const ANALYSIS_CREATION_TRANSFER_PREFIX = 'analysis-creation-transfer:';
export function analysisCreationReview(): never {
  throw Object.assign(new Error('The saved analyses need review before combining'), { code: 'analysis-creation-review' });
}

/** Select one complete saved creation chain; do not infer order between independent openings. */
export function analysisCreationSources(owner: string, source: ResourceRef, requests: readonly CommitRequest[]): CommitRequest[] {
  const related = requests.filter(request => request.owner === owner && equalValues(request.baseline.resource, source)
    && !['acknowledged', 'cancelled'].includes(request.state));
  const roots = related.filter(request => request.predecessor === null);
  const root = roots[0];
  if (roots.length !== 1 || !root || root.atomic || root.state !== 'refused' || root.command?.kind !== 'create'
    || root.result?.kind !== 'refused' || root.result.code !== 'analysis-exists'
    || root.baseline.value !== null || root.baseline.metadata !== null || !root.value
    || root.retentionScope !== analysisCreationScope(source.id)) return analysisCreationReview();
  const chain = [root];
  while (chain.length < related.length) {
    const next = related.filter(request => request.predecessor === chain.at(-1)!.id);
    if (next.length !== 1 || next[0].atomic || next[0].state !== 'queued' || next[0].command !== null || !next[0].value
      || chain.some(request => request.id === next[0].id)) return analysisCreationReview();
    chain.push(next[0]);
  }
  return chain;
}

/** One domain owner builds the exact replacement; the store owns its atomic capture and retirement. */
export function captureAnalysisCreation(owner: string, source: ResourceRef, target: ResourceSnapshot,
  requests: readonly CommitRequest[], text: BookText) {
  if (source.collection !== 'studyNotes' || target.resource.collection !== 'studyNotes'
    || source.id === target.resource.id || !target.value || target.metadata?.deleted || target.value.userId !== owner) return analysisCreationReview();
  const sources = analysisCreationSources(owner, source, requests);
  const root = sources[0], latest = sources.at(-1)!;
  if (sources.some(request => request.value?.userId !== owner)) return analysisCreationReview();
  const pinned = pinSavedDocument(owner, target, requests);
  if (pinned.conflicts.length || !pinned.draft || pinned.draft.userId !== owner) return analysisCreationReview();
  const planned = planStudyAnalysisCreation(root.value!, latest.value!, pinned.draft, text);
  if (planned.kind !== 'ready') return analysisCreationReview();
  const session = DataSession.restore(pinned); session.edit(planned.value);
  const proof: CaptureTransferProof = { source: { ...source }, requestIds: sources.map(request => request.id), value: latest.value! };
  const predecessorId = Object.entries(pinned.pending).sort((a, b) => b[1].generation - a[1].generation)[0]?.[0] ?? null;
  return { editorId: editorIdentity(`${ANALYSIS_CREATION_TRANSFER_PREFIX}${root.id}`, target.resource, ACTION_SLOT, latest.id),
    captured: session.checkpoint(), predecessorId, sources, proof, targetValue: pinned.draft,
    retentionScope: `${ANALYSIS_CREATION_TRANSFER_PREFIX}${root.id}` };
}
