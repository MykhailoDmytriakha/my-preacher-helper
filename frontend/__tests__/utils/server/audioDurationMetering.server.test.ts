/**
 * @jest-environment node
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

jest.unmock('music-metadata');

import { getMeteredAudioDurationSeconds } from '@/utils/server/audioDurationMetering.server';

const fixtureBlob = (relativePath: string, mimeType: string): Blob => {
  const contents = readFileSync(path.join(process.cwd(), relativePath));
  return new Blob([new Uint8Array(contents)], { type: mimeType });
};

describe('getMeteredAudioDurationSeconds', () => {
  it.each([
    ['public/samples/Charon-3.1-en.wav', 'audio/wav', 5.64],
    ['public/samples/onyx-standard-en.mp3', 'audio/mpeg', 3.264],
  ])('measures the real duration of %s with music-metadata', async (fixture, mimeType, expected) => {
    const duration = await getMeteredAudioDurationSeconds(
      fixtureBlob(fixture, mimeType),
      mimeType,
      'fallback text that must not determine a valid fixture duration'
    );

    expect(duration).toBeCloseTo(expected, 3);
  });

  it('fails closed to a non-zero text estimate when metadata parsing fails', async () => {
    const duration = await getMeteredAudioDurationSeconds(
      new Blob(['not audio'], { type: 'audio/mpeg' }),
      'audio/mpeg',
      'one two three four five six seven eight nine ten'
    );

    expect(duration).toBe(4);
  });

  it('never returns zero even when both audio and text are minimal', async () => {
    const duration = await getMeteredAudioDurationSeconds(
      new Blob([], { type: 'audio/wav' }),
      'audio/wav',
      ''
    );

    expect(duration).toBe(1);
  });
});
