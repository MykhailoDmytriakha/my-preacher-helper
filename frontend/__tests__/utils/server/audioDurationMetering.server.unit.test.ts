/**
 * @jest-environment node
 */
import { parseBuffer } from 'music-metadata';

import { getMeteredAudioDurationSeconds } from '@/utils/server/audioDurationMetering.server';

const mockParseBuffer = parseBuffer as jest.Mock;

describe('getMeteredAudioDurationSeconds fail-closed fallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses the non-zero text estimate when parsed metadata has no duration', async () => {
    mockParseBuffer.mockResolvedValue({ format: {} });

    const duration = await getMeteredAudioDurationSeconds(
      new Blob(['metadata-without-duration'], { type: 'audio/mpeg' }),
      'audio/mpeg',
      'one two three four five six seven eight nine ten'
    );

    expect(duration).toBe(4);
  });
});
