import { boundedActionTime } from './actionClock';
import { equalValues } from './fieldValues';
import { readServiceOrderInputValue, serviceOrderInputKey } from './serviceOrderInput';

import type { ServiceOrderInput } from './serviceOrderInput';
import type { SessionCheckpoint } from './session';
import type { ResourceSnapshot } from './types';

export const SERVICE_ORDER_INPUT_SLOT = 'service-order-input';

export type ServiceOrderReservePayload = {
  input: ServiceOrderInput;
  generation: string | null;
  editGeneration: number;
  createdAt?: string;
  title?: string;
};

export interface ServiceOrderReserveCopy {
  editorId: string;
  token: string;
  payload: ServiceOrderReservePayload;
  retire(): boolean;
}

export interface ServiceOrderReserveStorage {
  write(owner: string, serviceId: string, editorId: string, payload: ServiceOrderReservePayload): ServiceOrderReserveCopy | undefined;
  list(owner: string, serviceId: string): ServiceOrderReserveCopy[];
  listServices(owner: string): { id: string; title?: string }[];
  clearRefusal(owner: string, serviceId: string, editorId: string, payload: ServiceOrderReservePayload): void;
}

export function matchesServiceOrderReserve(snapshot: ResourceSnapshot, payload: ServiceOrderReservePayload): boolean {
  if (snapshot.resource.collection !== 'serviceOrders' || !snapshot.value || snapshot.metadata?.deleted) return false;
  return payload.generation === null
    ? typeof payload.createdAt === 'string' && snapshot.value.createdAt === payload.createdAt
    : snapshot.metadata?.generation === payload.generation;
}

export function includesServiceOrderReserve(checkpoint: SessionCheckpoint, payload: ServiceOrderReservePayload): boolean {
  const stored = checkpoint.serviceOrderInputs?.[serviceOrderInputKey(payload.input)];
  if (stored?.retainedOnly) return equalValues(stored, { ...payload.input, retainedOnly: true });
  return matchesServiceOrderReserve(checkpoint.confirmed, payload) && equalValues(stored, payload.input);
}

interface PendingInput {
  payload: ServiceOrderReservePayload;
  copy?: ServiceOrderReserveCopy;
}

/** Write only one addressed field before the current browser event can finish. */
export class ServiceOrderInputReserve {
  private readonly pending = new Map<string, PendingInput>();

  constructor(private readonly owner: string, private readonly serviceId: string, private readonly editorId: string,
    private readonly storage: ServiceOrderReserveStorage) {}

  admit(checkpoint: SessionCheckpoint, input: ServiceOrderInput): void {
    const { confirmed } = checkpoint;
    const key = serviceOrderInputKey(input);
    const payload = {
      input: checkpoint.serviceOrderInputs?.[key] ?? { ...input, time: boundedActionTime(input.time) ?? null },
      generation: confirmed.metadata?.generation ?? null,
      editGeneration: checkpoint.editGeneration,
      ...(typeof confirmed.value?.title === 'string' && { title: confirmed.value.title }),
      ...(typeof confirmed.value?.createdAt === 'string' && { createdAt: confirmed.value.createdAt }),
    };
    const copy = this.storage.write(this.owner, this.serviceId, this.editorId, payload);
    const previous = this.pending.get(key);
    this.pending.set(key, { payload, copy: copy ?? previous?.copy });
  }

  preserve(): void {
    for (const entry of this.pending.values()) {
      if (entry.copy && equalValues(entry.copy.payload, entry.payload)) continue;
      entry.copy = this.storage.write(this.owner, this.serviceId, this.editorId, entry.payload) ?? entry.copy;
    }
  }

  stored(checkpoint: SessionCheckpoint): void {
    for (const [key, entry] of this.pending) {
      const { payload, copy } = entry;
      const clean = !checkpoint.remoteCandidate && !Object.keys(checkpoint.pending).length
        && matchesServiceOrderReserve(checkpoint.confirmed, payload)
        && equalValues(readServiceOrderInputValue(checkpoint.confirmed.value, payload.input), payload.input.value)
        && !checkpoint.serviceOrderInputs?.[key];
      if (!clean && !includesServiceOrderReserve(checkpoint, payload)) continue;
      this.storage.clearRefusal(this.owner, this.serviceId, this.editorId, payload);
      if (!copy || copy.retire()) this.pending.delete(key);
    }
  }
}
