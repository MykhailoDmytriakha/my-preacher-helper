import { NextResponse } from 'next/server';

import { CHUNKS_CHANGED, storedSource } from '@/utils/audioChunkIdentity';
import { preparedAudioVersion, readPreparedAudioSources } from '@/utils/preparedAudioSources';

import type { AudioSourceMode } from '@/types/audioGeneration.types';

export { CHUNKS_CHANGED };

/** A conflict identifies the selected stored source; a different active projection is not that text. */
export function chunksChangedResponse(stored: Record<string, unknown> | undefined, requestedMode?: AudioSourceMode): NextResponse {
  const metadata = stored?.audioMetadata as { mode?: unknown } | undefined;
  const sources = readPreparedAudioSources(stored ?? {});
  const selected = requestedMode ?? storedSource(stored), source = sources[selected];
  return NextResponse.json(
    { code: CHUNKS_CHANGED, error: CHUNKS_CHANGED,
      chunks: requestedMode ? source?.chunks ?? [] : stored?.audioChunks ?? [],
      mode: requestedMode ?? metadata?.mode ?? null, sources, ...(source ? { source: preparedAudioVersion(source) } : {}) },
    { status: 409 }
  );
}
