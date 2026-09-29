import type { AudioChunk } from '@/types/audioGeneration.types';

/** The code every audio-chunk route answers with when the stored set is not the one the screen showed. */
export const CHUNKS_CHANGED = 'chunks-changed';

/**
 * WHAT A PERSON HEARS OF A CHUNK SET — the one rule the chunks route and the audio wizard use to
 * decide whether two sets are the same. Bookkeeping such as `createdAt` or a client `preview` is
 * not compared. An absent `kind` IS 'body': the database stores body chunks without it while the
 * optimize route answers with `kind ?? 'body'`.
 */
export function heardChunks(chunks: unknown): string {
  return JSON.stringify((Array.isArray(chunks) ? chunks : []).map(chunk => {
    const { sectionId, index, text, kind, role } = (chunk ?? {}) as Partial<AudioChunk>;
    return [sectionId ?? null, index ?? null, text ?? null, kind ?? 'body', role ?? null];
  }));
}

/** Which source a stored set came from; a sermon that never recorded one holds AI chunks (the wizard reads it the same way). */
export function storedSource(doc: { audioMetadata?: unknown } | undefined): 'ai' | 'raw' {
  return (doc?.audioMetadata as { mode?: unknown } | undefined)?.mode === 'raw' ? 'raw' : 'ai';
}

/**
 * A chunk as the sermon stores it. A client's cached chunk can lack `createdAt` (the engine's
 * schema requires it, so such a set was refused whole) or carry client-only fields such as
 * `preview`; neither belongs in the document.
 */
export function storedChunk(chunk: Partial<AudioChunk>, now: string): AudioChunk {
  const { text, sectionId, index, createdAt, kind, role } = chunk;
  return {
    text: text ?? '',
    sectionId: sectionId as AudioChunk['sectionId'],
    index: index ?? 0,
    createdAt: typeof createdAt === 'string' && createdAt ? createdAt : now,
    ...(kind ? { kind } : {}),
    ...(role ? { role } : {}),
  };
}
