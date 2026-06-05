/**
 * Generate a stable client-side id for a new entity. Sending this id with the
 * create request (instead of letting the server allocate one) makes creates
 * idempotent: if an offline-buffered create is replayed more than once — e.g. a
 * request that reached the server but whose response was lost — the server
 * upserts the same document id instead of creating a duplicate. It also lets the
 * UI navigate to the new record's detail route immediately, before the write
 * has round-tripped.
 */
export const newClientId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
