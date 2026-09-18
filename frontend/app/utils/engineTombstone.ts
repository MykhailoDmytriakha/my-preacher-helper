/**
 * A DOCUMENT THE DATA ENGINE DELETED IS NOT A DOCUMENT.
 *
 * The engine does not remove a deleted document: it leaves a tombstone, so a late write from
 * another device cannot bring the document back. Since 2026-09-18 a tombstone no longer carries
 * the legacy owner field, so no `where(userId == uid)` query returns it. Tombstones written
 * before that date still do — and a legacy reader that hydrates one draws a blank, editable
 * record for something that is not in the database. Every legacy LIST asks this one question.
 *
 * Deliberately free of engine imports: legacy readers on both sides of the wire use it, and the
 * architecture gate keeps features out of the engine's internals.
 */
export function isEngineTombstone(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const marker = (data as { _dataEngine?: unknown })._dataEngine;
  return Boolean(marker && typeof marker === 'object' && (marker as { deleted?: unknown }).deleted === true);
}
