/**
 * WHICH COLLECTIONS THE SERVER SERVES THROUGH THE ENGINE, AND WHICH ARE CLOSED TO LEGACY WRITERS.
 *
 * Two switches, because they cannot be thrown at the same moment:
 *
 * - DATA_ENGINE_COLLECTIONS (or the older all-or-nothing DATA_ENGINE_ENABLED=true) makes the
 *   engine's routes answer for a collection. It has to be on BEFORE a bundle that uses the engine
 *   is deployed — and the client's own switch is compiled into that bundle, so "the client flips"
 *   means a build, a service-worker swap and a voluntary reload on every device, over days.
 * - DATA_ENGINE_CLOSED_COLLECTIONS refuses every legacy write to a collection. It is the LAST
 *   step of a rollout, thrown only when every device runs the new bundle. Closing at the moment
 *   of serving would leave the bundle still in every browser unable to save at all.
 *
 * Between the two, legacy writers and the engine share the collection. A legacy write raises no
 * feed event, so readers are told `legacyOpen` and read the whole list instead of trusting the
 * feed alone (collections.ts).
 *
 * Pure env reading, no transport: both server.ts and legacyBoundary.server.ts ask here, so the
 * two can never disagree about what is served or closed.
 */
const listed = (value: string | undefined): string[] =>
  (value ?? '').split(',').map(entry => entry.trim()).filter(Boolean);

/** Whether the protocol is served at all on this deployment. */
export function isEngineServing(): boolean {
  return process.env.DATA_ENGINE_ENABLED === 'true' || listed(process.env.DATA_ENGINE_COLLECTIONS).length > 0;
}

export function isCollectionServed(collection: string): boolean {
  return process.env.DATA_ENGINE_ENABLED === 'true' || listed(process.env.DATA_ENGINE_COLLECTIONS).includes(collection);
}

/**
 * A closure counts only for a collection the engine serves: closing without serving would leave
 * nobody able to write, and a misconfiguration must not become an outage.
 */
export function isClosedToLegacyWriters(collection: string): boolean {
  return isCollectionServed(collection) && listed(process.env.DATA_ENGINE_CLOSED_COLLECTIONS).includes(collection);
}

/** True while legacy writers may still change a served collection without raising a feed event. */
export function isLegacyOpen(collection: string): boolean {
  return isCollectionServed(collection) && !isClosedToLegacyWriters(collection);
}
