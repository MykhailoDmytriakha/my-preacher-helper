import { createHash } from 'node:crypto';

import { isTagMembershipName, MAX_INLINE_TAG_NAME_LENGTH } from './tagMembershipOrder';

const digestPattern = /^[a-zA-Z0-9_-]{43}$/;

export type TagProofIdentity = { tag: string } | { tagDigest: string };

/** Old short-name proofs remain readable. A long name never enlarges its stored proof. */
export function tagProofIdentity(tag: string): TagProofIdentity {
  return tag.length <= MAX_INLINE_TAG_NAME_LENGTH ? { tag }
    : { tagDigest: createHash('sha256').update(JSON.stringify(tag)).digest('base64url') };
}

export function readTagProofIdentity(record: Record<string, unknown>, accepts = isTagMembershipName): TagProofIdentity | undefined {
  if (typeof record.tagDigest === 'string' && digestPattern.test(record.tagDigest) && record.tag === undefined) return { tagDigest: record.tagDigest };
  if (record.tagDigest === undefined && accepts(record.tag) && record.tag.length <= MAX_INLINE_TAG_NAME_LENGTH) return { tag: record.tag };
  return undefined;
}

export function tagProofKey(identity: string | TagProofIdentity): string {
  const key = typeof identity === 'string' ? tagProofIdentity(identity) : identity;
  return 'tag' in key ? 'tag:' + key.tag : 'digest:' + key.tagDigest;
}
