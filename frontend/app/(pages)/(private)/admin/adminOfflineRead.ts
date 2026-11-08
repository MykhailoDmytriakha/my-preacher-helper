import { get } from 'idb-keyval';

import { newClientId } from '@/utils/clientId';
import { answerWithin } from '@/utils/deviceStorage';
import { resolveOwnerUid } from '@/utils/queryKeys';
import { queryCacheStore } from '@/utils/queryPersister';
import { updateStoredValue } from '@/utils/storageUpdate';

export type AdminReadData = { users?: unknown; models?: unknown };
export type AdminReadCopy = AdminReadData & { owner: string; fence: string | null };

const keyFor = (owner: string): [string, string] => ['admin-offline-v1', owner];

function ownedCopy(owner: string, value: AdminReadCopy | undefined): AdminReadCopy | undefined {
  return value?.owner === owner && (value.fence === null || typeof value.fence === 'string') ? value : undefined;
}

export async function readAdminCopy(owner: string): Promise<AdminReadCopy | undefined> {
  try {
    const result = await answerWithin(get<AdminReadCopy>(keyFor(owner), queryCacheStore));
    return result.answered ? ownedCopy(owner, result.value) : undefined;
  } catch {
    return undefined;
  }
}

type Retention = { kind: 'kept'; copy: AdminReadCopy } | { kind: 'stale' | 'unavailable' };

/** A check begun before an explicit denial cannot restore the old data after it. */
export async function keepAdminRead(owner: string, fence: string | null,
  change: (previous: AdminReadCopy | undefined) => AdminReadData): Promise<Retention> {
  let result: Retention = { kind: 'unavailable' };
  try {
    const settled = await answerWithin(updateStoredValue<AdminReadCopy | undefined>(keyFor(owner), previous => {
      if (resolveOwnerUid() !== owner || (previous && !ownedCopy(owner, previous))) return previous;
      if ((previous?.fence ?? null) !== fence) {
        result = { kind: 'stale' };
        return previous;
      }
      const copy = { ...previous, owner, fence, ...change(previous) };
      result = { kind: 'kept', copy };
      return copy;
    }, queryCacheStore));
    return settled.answered ? result : { kind: 'unavailable' };
  } catch {
    // A device that refuses storage still permits an authorized live read.
    return { kind: 'unavailable' };
  }
}

export async function revokeAdminCopy(owner: string): Promise<void> {
  try {
    await answerWithin(updateStoredValue<AdminReadCopy>(keyFor(owner), () => ({ owner, fence: newClientId() }), queryCacheStore));
  } catch {
    // The current workspace still hides the copy immediately.
  }
}
