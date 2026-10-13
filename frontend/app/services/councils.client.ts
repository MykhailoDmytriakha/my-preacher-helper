'use client';

import type { Council } from '@/models/models';

/**
 * Councils are read and written only through the data engine (engineOwnedCollections.ts); what
 * stays here is the collection name and the shape the engine hooks give a stored document.
 */
export const COUNCILS_COLLECTION = 'councils';

export function hydrateCouncil(data: Record<string, unknown>, id: string): Council {
  return {
    ...(data as Omit<Council, 'id'>),
    id,
    topics: Array.isArray(data.topics) ? (data.topics as Council['topics']) : [],
    rev: typeof data.rev === 'number' ? data.rev : 0,
  };
}
