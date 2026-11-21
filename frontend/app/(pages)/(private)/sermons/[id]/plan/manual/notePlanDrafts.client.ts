import { z } from 'zod';

import { newClientId } from '@/utils/clientId';
import { readDraftAddress } from '@/utils/draftAddress';
import { clearDraftIfMatches, draftKey, findDraftCopies, readDraft, saveDraft } from '@/utils/durableDraft';
import { NotePlanRequestSchema, NotePlanResultSchema } from '@/utils/notePlan';

const aggregate = 'note-plan-proposal';
const listeners = new Set<(key: string) => void>();

const captured = z.object({
  id: z.string(),
  request: NotePlanRequestSchema,
  before: z.record(z.string()),
  labels: z.record(z.string()),
  language: z.enum(['en', 'ru', 'uk']).optional(),
  /** Every target cell was empty when the request started: the answer goes straight in, unreviewed. */
  autoApply: z.boolean().optional(),
});

const schema = z.discriminatedUnion('state', [
  captured.extend({ state: z.literal('pending'), unregistered: z.boolean().optional() }),
  captured.extend({ state: z.literal('ready'), result: NotePlanResultSchema }),
  captured.extend({ state: z.literal('failed'), error: z.string() }),
]);

export type ProposalDraft = z.infer<typeof schema>;
export type PendingProposal = Extract<ProposalDraft, { state: 'pending' }>;
export type ReadyProposal = Extract<ProposalDraft, { state: 'ready' }>;
export type ProposalScope = { owner: string; sermonId: string };

const keyFor = (scope: ProposalScope, id: string) => draftKey(scope.owner, scope.sermonId, aggregate, id);

function publish(key: string) {
  for (const listener of listeners) listener(key);
}

function decode(value: unknown, id?: string): ProposalDraft | undefined {
  const parsed = schema.safeParse(value);
  return parsed.success && parsed.data.id === id ? parsed.data : undefined;
}

export function listProposals(scope: ProposalScope): ProposalDraft[] {
  return findDraftCopies(scope.owner, scope.sermonId, aggregate).flatMap(copy => {
    const draft = decode(copy.value, readDraftAddress(copy.key)?.writerId);
    return draft ? [draft] : [];
  });
}

export function watchProposals(scope: ProposalScope, refresh: () => void) {
  const changed = (key: string) => {
    const address = readDraftAddress(key);
    if (address?.aggregate === aggregate && address.owner === scope.owner && address.documentId === scope.sermonId) refresh();
  };
  const storageChanged = (event: StorageEvent) => {
    if (event.key) changed(event.key);
    else refresh();
  };
  listeners.add(changed);
  window.addEventListener('storage', storageChanged);
  return () => {
    listeners.delete(changed);
    window.removeEventListener('storage', storageChanged);
  };
}

export function readProposal(scope: ProposalScope, id: string): ProposalDraft | undefined {
  return decode(readDraft(keyFor(scope, id))?.value, id);
}

export function beginProposal(scope: ProposalScope, input: Omit<z.infer<typeof captured>, 'id'>): PendingProposal | undefined {
  const draft: PendingProposal = { ...input, id: newClientId(), state: 'pending' };
  const key = keyFor(scope, draft.id);
  if (!saveDraft(key, draft)) {
    clearDraftIfMatches(key, draft);
    return;
  }
  publish(key);
  return draft;
}

/** Only an unresolved operation can publish; a late probe cannot replace a ready result. */
export function resolveProposal(scope: ProposalScope, value: ProposalDraft): boolean {
  const key = keyFor(scope, value.id);
  if (readProposal(scope, value.id)?.state !== 'pending' || !saveDraft(key, value)) return false;
  publish(key);
  return true;
}

export function discardProposal(scope: ProposalScope, value: ProposalDraft) {
  if (value.state === 'pending') return;
  const key = keyFor(scope, value.id);
  const current = readDraft(key);
  if (!current || decode(current.value, value.id)?.state !== value.state) return;
  clearDraftIfMatches(key, current.value, current);
  publish(key);
}
