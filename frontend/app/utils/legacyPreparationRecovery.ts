'use client';

import { discoverLegacyRecovery } from '@/data-engine/react.client';
import { serializeContent } from '@/utils/contentFingerprint';
import { draftKey } from '@/utils/durableDraft';

import type { ResourceSnapshot } from '@/data-engine/types';

type Store = Pick<Storage, 'length' | 'key' | 'getItem' | 'removeItem'>;
type Value = Record<string, unknown>;
export interface LegacyPreparationCopy {
  key: string; raw: string; owner: string; sermonId: string; value: Value;
}
const object = (value: unknown): value is Value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** A projected/foreign/deleted document cannot assign an owner to an old uid-less backup. */
export function ownsPreparationCopy(owner: string | null, snapshot: ResourceSnapshot | null): snapshot is ResourceSnapshot & { value: NonNullable<ResourceSnapshot['value']> } {
  return Boolean(owner && snapshot?.resource.collection === 'sermons' && snapshot.resource.id
    && snapshot.value?.userId === owner && !snapshot.metadata?.deleted);
}

/** Read both historical formats without moving, importing or rewriting either original. */
export function readLegacyPreparation(owner: string, confirmed: ResourceSnapshot, storage: Store = window.localStorage): LegacyPreparationCopy[] {
  if (!ownsPreparationCopy(owner, confirmed)) return [];
  const sermonId = confirmed.resource.id;
  const copies = discoverLegacyRecovery(owner, { resource: confirmed.resource, draftAggregates: ['preparation'], storage })
    .filter(source => source.kind === 'draft' && object(source.payload) && object(source.payload.value))
    .map(source => ({ key: source.id, raw: source.raw, owner, sermonId, value: (source.payload as { value: Value }).value }));
  const key = `prep-draft-backup-${sermonId}`, raw = storage.getItem(key);
  if (raw !== null) {
    try {
      const value: unknown = JSON.parse(raw);
      if (object(value)) copies.push({ key, raw, owner, sermonId, value });
    } catch { /* An unreadable original is kept byte for byte. */ }
  }
  return copies;
}

/** Only this one field is a legacy draft; no unrelated sermon field can prove an echo. */
export function preparationEcho(copy: LegacyPreparationCopy, server: ResourceSnapshot): boolean {
  return ownsPreparationCopy(copy.owner, server) && server.resource.id === copy.sermonId
    && serializeContent(copy.value) === serializeContent(server.value.preparation ?? {});
}

/** Never remove a replacement that arrived while a server read or a confirmation was pending. */
export function removeLegacyPreparation(copy: LegacyPreparationCopy, owner: string, confirmed: ResourceSnapshot, storage: Store = window.localStorage): boolean {
  const expectedKey = copy.key === draftKey(copy.owner, copy.sermonId, 'preparation') || copy.key === 'prep-draft-backup-' + copy.sermonId;
  if (!expectedKey || owner !== copy.owner || !ownsPreparationCopy(owner, confirmed) || confirmed.resource.id !== copy.sermonId
    || storage.getItem(copy.key) !== copy.raw) return false;
  storage.removeItem(copy.key);
  return true;
}

/** Full readable field values; export separately retains the exact original record and format. */
export function preparationCopyText(value: Value, label: (field: string) => string, flag: (value: boolean) => string): string {
  const lines = (current: unknown): string[] => {
    if (current === null || current === undefined) return [];
    if (typeof current === 'boolean') return [flag(current)];
    if (typeof current === 'string' || typeof current === 'number') return [String(current)];
    if (Array.isArray(current)) return current.flatMap(lines);
    return Object.entries(current as Value).flatMap(([field, entry]) => {
      const inner = lines(entry);
      return inner.length ? [label(field) + ':', ...inner.map(line => '  ' + line)] : [];
    });
  };
  return lines(value).join('\n');
}
