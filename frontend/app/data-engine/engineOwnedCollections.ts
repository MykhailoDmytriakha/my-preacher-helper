/**
 * COLLECTIONS THE ENGINE OWNS ON EVERY DEPLOYMENT.
 *
 * Each is served by the engine, closed to legacy writers and written only through the engine
 * editor, whatever the environment says: production, a preview, local dev and the test suite all
 * take the same road, so a check made on one of them tells the truth about the others. The list
 * grows one collection at a time while the legacy writers are removed, and ends equal to
 * `closedToBrowserWrites` in `frontend/firestore.rules` — a test pins every entry to that list.
 *
 * The environment switches (`NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS`, `DATA_ENGINE_COLLECTIONS`,
 * `DATA_ENGINE_CLOSED_COLLECTIONS`) can still add a collection that is not here; they cannot take
 * one of these away. Pure data, no transport: clientPolicy.ts and activation.ts both read it.
 */
export const ENGINE_OWNED_COLLECTIONS: readonly string[] = ['planTemplates', 'tags'];

export const isEngineOwned = (collection: string): boolean => ENGINE_OWNED_COLLECTIONS.includes(collection);
