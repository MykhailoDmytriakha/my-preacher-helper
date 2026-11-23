/** The public document-state fields needed to prove a durable local handoff. */
export interface DurablePlanState {
  durable: boolean;
  checkpoint: {
    confirmed: { resource: { collection: string; id: string } };
    draft: Record<string, unknown> | null;
    planCellDrafts?: Record<string, { text: string }>;
    pending?: Record<string, { generation: number; value: Record<string, unknown> | null }>;
  };
}

export function showPlanCellDrafts(buffered: Record<string, string>, drafts: DurablePlanState['checkpoint']['planCellDrafts']): Record<string, string> {
  return drafts ? { ...buffered, ...Object.fromEntries(Object.entries(drafts).map(([id, draft]) => [id, draft.text])) } : buffered;
}

/** One selected Save in the engine covers its captured words, including after a recovery. */
export function showDirtyPlanCells(buffered: Record<string, boolean>, checkpoint: DurablePlanState['checkpoint'] | undefined): Record<string, boolean> {
  if (!checkpoint?.planCellDrafts) return buffered;
  const latest = Object.values(checkpoint.pending ?? {}).reduce<{ generation: number; value: Record<string, unknown> | null } | undefined>(
    (prior, intent) => !prior || intent.generation > prior.generation ? intent : prior, undefined);
  const submitted = latest?.value?.planText as Record<string, unknown> | undefined;
  return { ...buffered, ...Object.fromEntries(Object.entries(checkpoint.planCellDrafts).map(([id, cell]) => [id, submitted?.[id] !== cell.text])) };
}
