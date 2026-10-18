/**
 * Reversible rollout switch for Google TTS quality chunks + browser batching.
 * Flip this one line to `false` to restore the legacy section-piece/single-request path.
 */
export const GOOGLE_SMALL_CHUNKING = true;

/** The browser and server share one bounded transport batch, separate from export admission. */
export const AUDIO_EXPORT_BATCH_LIMIT = 3;

/** Bounded application attempts; provider SDK transport retries are separate. */
export const AUDIO_EXPORT_CHUNK_ATTEMPTS = 2;
