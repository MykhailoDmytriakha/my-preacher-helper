import { parseBuffer } from 'music-metadata';

import { estimateDuration } from '@/api/clients/tts.client';

const conservativeTextEstimate = (text: string): number =>
  Math.max(1, estimateDuration(text));

/**
 * Returns a billing-safe duration for generated audio.
 *
 * Unlike inbound recording validation, metering must fail closed: invalid or
 * incomplete metadata falls back to the chunk's text estimate and never zero.
 */
export async function getMeteredAudioDurationSeconds(
  audioBlob: Blob,
  mimeType: string,
  sourceText: string
): Promise<number> {
  const fallback = conservativeTextEstimate(sourceText);

  try {
    const buffer = Buffer.from(await audioBlob.arrayBuffer());
    const metadata = await parseBuffer(buffer, { mimeType });
    const duration = metadata.format.duration;

    return typeof duration === 'number' && Number.isFinite(duration) && duration > 0
      ? duration
      : fallback;
  } catch {
    return fallback;
  }
}
