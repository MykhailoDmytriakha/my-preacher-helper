jest.mock('openai/shims/node', () => ({}), { virtual: true });
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({})),
}));

import { GOOGLE_SMALL_CHUNKING } from '@/config/audioGeneration';
import {
  GOOGLE_TTS_MAX_CHUNK_SIZE,
  splitGoogleTextForGeneration,
} from '@/utils/server/googleTtsChunking';

describe('Google TTS chunking rollout flag', () => {
  it('keeps the new quality path behind one enabled-by-default flag', () => {
    expect(GOOGLE_SMALL_CHUNKING).toBe(true);
  });

  it('switches between even quality chunks and the intact legacy request-limit path', () => {
    const text = 'A complete sentence for Google audio quality. '.repeat(140).trim();

    const qualityChunks = splitGoogleTextForGeneration(text, true);
    const legacyChunks = splitGoogleTextForGeneration(text, false);

    expect(qualityChunks.length).toBeGreaterThan(1);
    expect(Math.max(...qualityChunks.map(chunk => chunk.length))).toBeLessThanOrEqual(4000);
    expect(legacyChunks).toEqual([text]);
    expect(text.length).toBeLessThan(GOOGLE_TTS_MAX_CHUNK_SIZE);
  });
});
