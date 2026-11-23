'use client';

import { z } from 'zod';

import { readDraftAddress } from '@/utils/draftAddress';
import { clearDraftStorageRefusal, draftKey, findDraftCopies, listDraftKeys, readDraft, retireDraftCapture, saveDraft } from '@/utils/durableDraft';

import { isDocumentEditorSlot } from './editorIdentity';
import { serviceOrderInputKey } from './serviceOrderInput';
import { serviceOrderInputSchema } from './serviceOrderInputCodec';
import { SERVICE_ORDER_INPUT_SLOT } from './serviceOrderInputReserve';

import type { ServiceOrderReserveCopy, ServiceOrderReservePayload, ServiceOrderReserveStorage } from './serviceOrderInputReserve';

const schema = z.object({ input: serviceOrderInputSchema, generation: z.string().min(1).nullable(), editGeneration: z.number().int().safe().positive(), createdAt: z.string().optional(), title: z.string().optional() });
const address = (owner: string, serviceId: string, editorId: string, payload: ServiceOrderReservePayload) =>
  draftKey(owner, serviceId, SERVICE_ORDER_INPUT_SLOT, JSON.stringify([editorId, serviceOrderInputKey(payload.input)]));

function copyFor(owner: string, serviceId: string, key: string, value: unknown, token?: string): ServiceOrderReserveCopy | undefined {
  if (!token) return;
  const stored = schema.safeParse(value);
  if (!stored.success) return;
  const raw = readDraftAddress(key)?.writerId;
  if (!raw) return;
  let writer: unknown;
  try { writer = JSON.parse(raw); } catch { return; }
  if (!Array.isArray(writer) || typeof writer[0] !== 'string') return;
  const editorId = writer[0];
  const payload = stored.data;
  if (!isDocumentEditorSlot(editorId, { collection: 'serviceOrders', id: serviceId }, SERVICE_ORDER_INPUT_SLOT)
    || key !== address(owner, serviceId, editorId, payload)) return;
  return { editorId, token, payload, retire: () => retireDraftCapture(key, token, value) };
}

export const localServiceOrderReserveStorage: ServiceOrderReserveStorage = {
  write: (owner, serviceId, editorId, payload) => {
    const key = address(owner, serviceId, editorId, payload);
    if (!saveDraft(key, payload, undefined, 'renew')) return;
    const record = readDraft(key);
    return copyFor(owner, serviceId, key, record?.value, record?.captureToken);
  },
  list: (owner, serviceId) => findDraftCopies(owner, serviceId, SERVICE_ORDER_INPUT_SLOT).flatMap(record =>
    copyFor(owner, serviceId, record.key, record.value, record.captureToken) ?? []),
  listServices: owner => listDraftKeys().flatMap(key => {
    const address = readDraftAddress(key);
    if (!address || address.owner !== owner || address.aggregate !== SERVICE_ORDER_INPUT_SLOT) return [];
    const record = readDraft(key);
    const copy = copyFor(owner, address.documentId, key, record?.value, record?.captureToken);
    return copy ? [{ id: address.documentId, title: copy.payload.title }] : [];
  }),
  clearRefusal: (owner, serviceId, editorId, payload) => clearDraftStorageRefusal(address(owner, serviceId, editorId, payload), payload),
};
