import { object } from './fieldValues';
import { proofRevision } from './rowFieldAction';

import type { TagMembershipProof } from './tagMembershipOrder';
import type { TagProofIdentity } from './tagProofIdentity.server';
import type { DocumentData, EngineMetadata } from './types';

// The old count is only a storage format choice. The command envelope owns wire admission.
const LEGACY_ENTRY_COUNT = 64;
const MAX_PROOF_BYTES = 256 * 1024;
// Leave room for Firestore's native representation and other engine metadata.
const DOCUMENT_PROOF_CEILING = 960 * 1024;

type RowScope = { rowId: string; rowCreatedAt: string };
type Member = TagProofIdentity & Pick<TagMembershipProof, 'present'>;
type Group = Omit<TagMembershipProof, 'present'> & Partial<RowScope> & { members: Member[] };
type Entry = TagMembershipProof & TagProofIdentity & Partial<RowScope>;

export function readTagProofStorage(raw: unknown): { floor: number; entries: unknown[] } {
  if (!object(raw)) return { floor: 0, entries: [] };
  const floor = proofRevision(raw.floor) ? raw.floor : 0;
  if (!Array.isArray(raw.groups)) return { floor, entries: Array.isArray(raw.entries) ? raw.entries.slice(0, LEGACY_ENTRY_COUNT) : [] };
  const entries: unknown[] = [];
  for (const group of raw.groups) {
    if (!object(group) || !Array.isArray(group.members)) continue;
    const { members, ...stamp } = group;
    for (const member of members) if (object(member)) entries.push({
      ...stamp, present: member.present,
      ...(member.tag !== undefined && { tag: member.tag }),
      ...(member.tagDigest !== undefined && { tagDigest: member.tagDigest }),
    });
  }
  return { floor, entries };
}

const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

/** Keep recent evidence under a byte budget, charging the shared stamp once per group. */
export function retainTagProofStorage(entries: Iterable<Entry>, floor: number, value: DocumentData, metadata: EngineMetadata) {
  const recent = [...entries].sort((left, right) => right.revision - left.revision);
  if (!recent.length) return floor ? { floor, entries: [] } : undefined;
  const available = Math.min(MAX_PROOF_BYTES, DOCUMENT_PROOF_CEILING - jsonBytes({ ...value, _dataEngine: metadata }));
  const legacy = { floor, entries: recent };
  if (recent.length <= LEGACY_ENTRY_COUNT && jsonBytes(legacy) <= available) return legacy;

  const groups = new Map<string, Group>();
  let bytes = jsonBytes({ floor: Number.MAX_SAFE_INTEGER, groups: [] });
  for (const proof of recent) {
    const { revision, operationId, time, causal, rowId, rowCreatedAt, present } = proof;
    const stamp = { revision, operationId, time, causal, ...(rowId !== undefined && { rowId, rowCreatedAt }) };
    const key = JSON.stringify(stamp);
    const group = groups.get(key);
    const member = 'tag' in proof ? { tag: proof.tag, present } : { tagDigest: proof.tagDigest, present };
    const cost = jsonBytes(member) + 1 + (group ? 0 : jsonBytes({ ...stamp, members: [] }) + 1);
    if (bytes + cost > available) {
      floor = Math.max(floor, revision);
      continue;
    }
    if (group) group.members.push(member);
    else groups.set(key, { ...stamp, members: [member] });
    bytes += cost;
  }
  return { floor, groups: [...groups.values()] };
}
