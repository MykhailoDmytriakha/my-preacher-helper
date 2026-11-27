import { notePlanContextKey, notePlanTargetNodes, type NotePlanResult } from '@/utils/notePlan';

import { usePlanResultOriginChecks } from '../usePlanResultOriginChecks';

import type { PendingProposal, ProposalDraft, ReadyProposal } from './notePlanDrafts.client';
import type { Sermon } from '@/models/models';
import type { PlanInboxItem } from '@/utils/planResultOrigin';

export type Proposal = ReadyProposal & NotePlanResult & { inbox?: true; checkingOrigin?: boolean };
export type PlanPending = PendingProposal & { inbox?: true };

const allRecoveryPoints = (sermon: Sermon) => [
  ...(sermon.outline?.introduction ?? []), ...(sermon.outline?.main ?? []), ...(sermon.outline?.conclusion ?? []),
];

export function useRecoveredNotePlanProposals(inboxItems: PlanInboxItem[] | undefined, items: ProposalDraft[],
  sermon: Sermon, currentCells: Record<string, string>) {
  const remote = (inboxItems ?? []).filter(item => !items.some(local => local.id === item.id));
  const remoteBasis = (item: PlanInboxItem) => {
    const { pointId, targetNodeId, style, openingKey } = item.value;
    const point = allRecoveryPoints(sermon).find(candidate => candidate.id === pointId);
    const targets = point ? notePlanTargetNodes(point, targetNodeId) : [];
    const ids = item.state === 'ready' && item.value.mode === 'note' ? Object.keys(item.value.proposal.contentByNodeId)
      : targets.length ? targets.map(node => node.nodeId) : [targetNodeId ?? pointId];
    const expectedContext = notePlanContextKey(sermon, pointId);
    return {
      id: item.id, openingKey, request: { outlinePointId: pointId, targetNodeId, style, expectedContext },
      before: Object.fromEntries(ids.map(id => [id, currentCells[id] ?? ''])),
      labels: Object.fromEntries(ids.map(id => [id, targets.find(node => node.nodeId === id)?.title ?? id])),
    };
  };
  const bases = remote.map(item => ({ item, basis: remoteBasis(item) }));
  const matches = usePlanResultOriginChecks(bases.flatMap(({ item, basis }) => item.state === 'ready' ? [{
    id: item.id, cells: basis.before, context: basis.request.expectedContext,
    openingKey: item.value.openingKey, contextKey: item.value.contextKey,
  }] : []));
  const recovered: Proposal[] = bases.flatMap(({ item, basis }) => {
    if (item.state !== 'ready' || item.value.mode !== 'note') return [];
    const result = item.value.proposal;
    const verified = matches?.[item.id];
    return [{ ...basis, ...result, state: 'ready', result, inbox: true, checkingOrigin: verified === undefined,
      sourceChanged: verified === false }];
  });
  const waiting: PlanPending[] = bases.flatMap(({ item, basis }) =>
    item.state === 'pending' ? [{ ...basis, state: 'pending', inbox: true }] : []);
  return { recovered, waiting };
}
