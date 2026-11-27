import { newClientId } from '@/utils/clientId';
import { readDraftAddress } from '@/utils/draftAddress';
import { clearDraftIfMatches, draftKey, findDraftCopies, readDraft, saveDraft } from '@/utils/durableDraft';

import type { PlanStyle } from '@/api/clients/planTypes';
import type { PlanResultOrigin } from '@/utils/planResultOrigin';

type Attempt = { id: string; style: PlanStyle; openingKey?: string; contextKey?: string; inboxOrigin?: PlanResultOrigin };
export type PlanPointResult = Attempt & (
  { kind: 'pending'; receiptMissing?: boolean }
  | { kind: 'ready'; content: string; basisCheck?: 'checking' | 'changed' }
  | { kind: 'failed'; message: string }
);

const aggregate = 'plan-point-generation';
const listeners = new Set<(key: string) => void>();
const unsaved = new Map<string, PlanPointResult>();

export const planPointResultKey = (owner: string, sermonId: string, pointId: string) =>
  draftKey(owner, sermonId, aggregate, pointId);

export function readPlanPointResult(key: string): PlanPointResult | undefined {
  const result = unsaved.get(key) ?? readDraft<PlanPointResult>(key)?.value;
  return result && typeof result.id === 'string' && ['memory', 'narrative', 'exegetical'].includes(result.style)
    && (result.kind === 'pending' || result.kind === 'ready' && typeof result.content === 'string'
      || result.kind === 'failed' && typeof result.message === 'string') ? result : undefined;
}

export function isPlanPointResultStored(key: string, result: Extract<PlanPointResult, { kind: 'ready' }>): boolean {
  const stored = readDraft<PlanPointResult>(key)?.value;
  return stored?.kind === 'ready' && stored.id === result.id && stored.content === result.content;
}

export function listPlanPointResults(owner: string, sermonId: string): Record<string, PlanPointResult> {
  const keys = new Set([...findDraftCopies(owner, sermonId, aggregate).map(copy => copy.key), ...unsaved.keys()]);
  return Object.fromEntries([...keys].flatMap(key => {
    const address = readDraftAddress(key);
    if (address?.owner !== owner || address.documentId !== sermonId || address.aggregate !== aggregate || !address.writerId) return [];
    const result = readPlanPointResult(key);
    return result ? [[address.writerId, result]] : [];
  }));
}

function publish(key: string) {
  for (const listener of listeners) listener(key);
}

export function watchPlanPointResults(owner: string, sermonId: string, listener: () => void): () => void {
  const onKeyChange = (key: string) => {
    const address = readDraftAddress(key);
    if (address?.aggregate === aggregate && address.owner === owner && address.documentId === sermonId) listener();
  };
  const onStorage = (event: StorageEvent) => {
    if (!event.key) listener();
    else onKeyChange(event.key);
  };
  listeners.add(onKeyChange);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onKeyChange);
    window.removeEventListener('storage', onStorage);
  };
}

export function retainPlanPointResult(key: string, value: PlanPointResult, prior?: PlanPointResult): void {
  const current = readPlanPointResult(key);
  if (current && (current.id !== value.id || !prior)) return;
  // A check can report no receipt while the original request is still reaching the server.
  // Accept its later answer while this exact attempt is still open.
  const lateAnswer = value.kind === 'ready' && current?.kind === 'failed';
  if (prior && (!current || current.kind !== prior.kind && !lateAnswer)) return;
  const persisted = saveDraft(key, value);
  if (persisted) unsaved.delete(key);
  else unsaved.set(key, value);
  publish(key);
}

export function beginPlanPointResult(key: string, style: PlanStyle): PlanPointResult | undefined {
  if (readPlanPointResult(key)) return undefined;
  const result: PlanPointResult = { id: newClientId(), style, kind: 'pending' };
  // A closed tab cannot recover a paid request whose identity never reached storage.
  if (!saveDraft(key, result)) {
    // The request was never sent, so a later storage retry must not restore its pending card.
    clearDraftIfMatches(key, result);
    return undefined;
  }
  publish(key);
  return result;
}

export function bindPlanPointOpening(key: string, attempt: PlanPointResult, origin: { openingKey: string; contextKey?: string }): PlanPointResult | undefined {
  const current = readPlanPointResult(key);
  if (current?.id !== attempt.id || current.kind !== 'pending') return undefined;
  const bound = { ...current, ...origin };
  if (!saveDraft(key, bound)) return undefined;
  publish(key);
  return bound;
}

export function dismissPlanPointResult(key: string, result: PlanPointResult): void {
  const current = readPlanPointResult(key);
  if (current?.id !== result.id || current.kind !== result.kind) return;
  if (current.kind === 'ready' && result.kind === 'ready' && current.content !== result.content) return;
  if (unsaved.get(key)?.id === result.id) unsaved.delete(key);
  clearDraftIfMatches(key, current);
  const earlierCopy = readDraft<PlanPointResult>(key)?.value;
  if (earlierCopy?.id === result.id && earlierCopy.kind === 'pending') clearDraftIfMatches(key, earlierCopy);
  publish(key);
}
