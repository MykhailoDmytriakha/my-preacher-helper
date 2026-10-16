import { SERVICE_ORDER_CATALOG } from '@/utils/serviceOrderCatalog';

import type { ResourceSnapshot } from '@/data-engine/types';
import type { ServiceOrderCatalogKey } from '@/models/models';

export const isServiceOrderCatalogKey = (value: unknown): value is ServiceOrderCatalogKey =>
  typeof value === 'string' && SERVICE_ORDER_CATALOG.includes(value as ServiceOrderCatalogKey);

const SEED_ID_PREFIX = 'service-order-';
const ownerKey = (owner: string) => owner.split('').map(unit => unit.charCodeAt(0).toString(16).padStart(4, '0')).join('');
export const isServiceOrderSeedTarget = (id: string): boolean => id.startsWith(SEED_ID_PREFIX);
const prefix = (owner: string, key: ServiceOrderCatalogKey) => `${SEED_ID_PREFIX}${ownerKey(owner)}-${key}-`;

/** A new explicit seed after deletion gets a new identity; late old seeds keep their old target. */
export function serviceOrderSeedId(owner: string, key: ServiceOrderCatalogKey, cycle = 0): string {
  if (!Number.isSafeInteger(cycle) || cycle < 0) throw new Error('Invalid service-order seed cycle');
  return prefix(owner, key) + cycle;
}

export function serviceOrderSeedCycle(owner: string, key: ServiceOrderCatalogKey, id: string): number | null {
  const start = prefix(owner, key);
  if (!id.startsWith(start)) return null;
  const suffix = id.slice(start.length), cycle = Number(suffix);
  return /^(0|[1-9]\d*)$/.test(suffix) && Number.isSafeInteger(cycle) ? cycle : null;
}

/** Call only with the complete server-confirmed collection, including its tombstones. */
export function nextServiceOrderSeedId(owner: string, key: ServiceOrderCatalogKey, snapshots: readonly ResourceSnapshot[]): string {
  let next = 0;
  for (const snapshot of snapshots) {
    if (snapshot.resource.collection !== 'serviceOrders' || !snapshot.metadata?.deleted) continue;
    const cycle = serviceOrderSeedCycle(owner, key, snapshot.resource.id);
    if (cycle !== null) next = Math.max(next, cycle + 1);
  }
  return serviceOrderSeedId(owner, key, next);
}
