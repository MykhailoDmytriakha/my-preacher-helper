/** The public document-state fields needed to prove a durable local handoff. */
export interface DurablePlanState {
  durable: boolean;
  checkpoint: {
    confirmed: { resource: { collection: string; id: string } };
    draft: Record<string, unknown> | null;
  };
}

export function durablePlanCells(state: DurablePlanState | null | undefined, owner: string | null | undefined, documentId: string | null | undefined): Record<string, string> | null {
  const resource = state?.checkpoint.confirmed.resource;
  const draft = state?.checkpoint.draft;
  if (!state?.durable || !owner || !documentId || resource?.collection !== 'sermons'
    || resource.id !== documentId || draft?.userId !== owner) return null;
  const text = draft.planText;
  if (!text || typeof text !== 'object' || Array.isArray(text)) return null;
  return Object.fromEntries(Object.entries(text).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}
