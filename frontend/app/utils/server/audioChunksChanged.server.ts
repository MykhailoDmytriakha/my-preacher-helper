import { NextResponse } from 'next/server';

import { CHUNKS_CHANGED } from '@/utils/audioChunkIdentity';

export { CHUNKS_CHANGED };

/** 409 with what the database holds now, so the wizard shows it instead of its stale view. */
export function chunksChangedResponse(stored: Record<string, unknown> | undefined): NextResponse {
  const metadata = stored?.audioMetadata as { mode?: unknown } | undefined;
  return NextResponse.json(
    { code: CHUNKS_CHANGED, error: CHUNKS_CHANGED, chunks: stored?.audioChunks ?? [], mode: metadata?.mode ?? null },
    { status: 409 }
  );
}
