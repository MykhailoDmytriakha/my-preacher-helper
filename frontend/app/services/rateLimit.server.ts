import { createHash } from 'crypto';

import { adminDb } from '@/config/firebaseAdminConfig';

const RATE_LIMIT_COLLECTION = 'rateLimits';

export const FEEDBACK_RATE_LIMIT_MAX_SUBMISSIONS = 20;
export const FEEDBACK_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export interface SlidingWindowRateLimitOptions {
  scope: string;
  key: string;
  limit: number;
  windowMs: number;
  now?: Date;
}

export type SlidingWindowRateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; remaining: 0; retryAfterMs: number };

interface StoredRateLimitDocument {
  timestamps?: unknown;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Atomically consumes one event from a Firestore-backed rolling window.
 * The stored timestamp array is replaced with only live entries on every
 * accepting write, keeping the document bounded to approximately `limit` items.
 */
export async function consumeSlidingWindowRateLimit({
  scope,
  key,
  limit,
  windowMs,
  now = new Date(),
}: SlidingWindowRateLimitOptions): Promise<SlidingWindowRateLimitResult> {
  const nowMs = now.getTime();
  const cutoffMs = nowMs - windowMs;
  const keyHash = hash(key);
  const documentId = hash(`${scope}\0${key}`);
  const rateLimitRef = adminDb.collection(RATE_LIMIT_COLLECTION).doc(documentId);

  return adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(rateLimitRef);
    const data = snapshot.exists
      ? snapshot.data() as StoredRateLimitDocument | undefined
      : undefined;
    const storedTimestamps = Array.isArray(data?.timestamps) ? data.timestamps : [];
    const recentTimestamps = storedTimestamps
      .filter((timestamp): timestamp is number => (
        typeof timestamp === 'number'
        && Number.isFinite(timestamp)
        && timestamp > cutoffMs
      ))
      .sort((left, right) => left - right);

    if (recentTimestamps.length >= limit) {
      const nextAvailableIndex = recentTimestamps.length - limit;
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(
          1,
          recentTimestamps[nextAvailableIndex] + windowMs - nowMs
        ),
      };
    }

    const nextTimestamps = [...recentTimestamps, nowMs]
      .sort((left, right) => left - right);
    transaction.set(rateLimitRef, {
      scope,
      keyHash,
      timestamps: nextTimestamps,
      updatedAt: nowMs,
    });

    return {
      allowed: true,
      remaining: limit - nextTimestamps.length,
    };
  });
}
