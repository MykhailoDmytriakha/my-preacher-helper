import { notePlanContextKey } from '@/utils/notePlan';

import { usePlanResultOriginChecks } from './usePlanResultOriginChecks';

import type { PlanPointResult } from './planPointResult.client';
import type { Sermon } from '@/models/models';
import type { PlanInboxItem } from '@/utils/planResultOrigin';

export function useRecoveredPlanPointResults(inboxItems: PlanInboxItem[] | undefined, localResults: Record<string, PlanPointResult>,
  sermon: Sermon | null, generatedContent: Record<string, string>) {
  const readyInbox = (inboxItems ?? []).flatMap(item => item.state === 'ready' && item.value.mode === 'thoughts'
    ? [{ id: item.id, ...item.value }] : []);
  const byInboxId = new Map(readyInbox.map(item => [item.id, item]));
  const checkedLocal = Object.entries(localResults).flatMap(([pointId, item]) => {
    if (item.kind !== 'ready' || !item.openingKey || !item.contextKey || byInboxId.has(item.id)) return [];
    const { id, openingKey, contextKey } = item;
    return [{ id, pointId, openingKey, contextKey }];
  });
  const matches = usePlanResultOriginChecks(sermon ? [...readyInbox, ...checkedLocal].map(({ id, pointId, openingKey, contextKey }) => ({
    id, openingKey, contextKey, cells: { [pointId]: generatedContent[pointId] ?? '' },
    context: notePlanContextKey(sermon, pointId),
  })) : []);
  const basisCheck = (id: string): 'checking' | 'changed' | undefined =>
    matches?.[id] === true ? undefined : matches?.[id] === false ? 'changed' : 'checking';
  const inboxResults: Record<string, PlanPointResult> = Object.fromEntries([...(inboxItems ?? [])].reverse().flatMap<[string, PlanPointResult]>(item => {
    const { pointId, style } = item.value;
    if (item.state === 'pending') return [[pointId, { id: item.id, style, inboxOrigin: item.value, kind: 'pending' }]];
    if (item.value.mode !== 'thoughts' || generatedContent[pointId] === item.value.content) return [];
    return [[pointId, { id: item.id, style, inboxOrigin: item.value, kind: 'ready', content: item.value.content,
      basisCheck: basisCheck(item.id) }]];
  }));
  const recoveredResults = { ...inboxResults, ...Object.fromEntries(Object.entries(localResults).map(([pointId, item]) => {
    const matching = byInboxId.get(item.id);
    if (item.kind !== 'ready') return [pointId, item];
    return [pointId, { ...item, ...(matching && { inboxOrigin: matching }),
      ...(matching || item.openingKey && item.contextKey ? { basisCheck: basisCheck(item.id) } : {}) }];
  })) };
  return { inboxResults, recoveredResults };
}
