/**
 * Tests the even-split chunking rule used for the OpenAI quality TTS path.
 *
 * Rule (user-specified): N = max(1, round(len / 1750)); split into N EVEN chunks on
 * sentence boundaries. So a 3000-char point → 2×1500 (not greedy 1750+1250 tail),
 * 5000 → 3×~1667, while 2500 stays a single chunk.
 *
 * The `openai` import in tts.client is mocked so the module loads without an API key.
 */
jest.mock('openai/shims/node', () => ({}), { virtual: true });
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({})),
}));

import { splitTextEvenly, EVEN_SPLIT_IDEAL_SIZE } from '@/api/clients/tts.client';

/** Build text of ~`chars` length out of short, period-terminated sentences. */
function makeText(chars: number): string {
  const sentence = 'Это короткое тестовое предложение для проверки нарезки. '; // ~55 chars
  let t = '';
  while (t.length < chars) t += sentence;
  return t.slice(0, chars).trim();
}

const IDEAL = EVEN_SPLIT_IDEAL_SIZE; // 1750

describe('splitTextEvenly — chunk count follows N = round(len / 1750)', () => {
  // [inputLen, expectedChunks] — mirrors the examples the user gave verbatim.
  const cases: Array<[number, number]> = [
    [1500, 1],
    [2000, 1],
    [2500, 1], // round(2500/1750)=1 → stays single
    [3000, 2], // round(3000/1750)=2 → 2×~1500
    [5000, 3], // round(5000/1750)≈2.86 → 3×~1667
    [7000, 4],
    [6827, 4], // the real "monster" point measured in the DB
  ];

  it.each(cases)('len %i → %i chunk(s)', (len, expected) => {
    const chunks = splitTextEvenly(makeText(len));
    expect(chunks.length).toBe(expected);
  });
});

describe('splitTextEvenly — balance & safety properties', () => {
  it('never produces a tiny tail chunk (all chunks ~equal)', () => {
    const chunks = splitTextEvenly(makeText(5000));
    const target = 5000 / chunks.length;
    for (const c of chunks) {
      expect(c.length).toBeGreaterThan(target * 0.5);
      expect(c.length).toBeLessThan(target * 1.5);
    }
  });

  it('never exceeds the OpenAI 4096-char hard cap', () => {
    for (const len of [2625, 4000, 8000, 12000, 20000]) {
      const chunks = splitTextEvenly(makeText(len));
      for (const c of chunks) expect(c.length).toBeLessThanOrEqual(4096);
    }
  });

  it('largest possible single chunk stays under ~2625 (the round() boundary)', () => {
    // 2624 → round(2624/1750)=1 (single); 2625 → round=2 (splits).
    expect(splitTextEvenly(makeText(2624)).length).toBe(1);
    expect(splitTextEvenly(makeText(2625)).length).toBe(2);
  });

  it('preserves the text (no content lost across chunks)', () => {
    const text = makeText(5000);
    const chunks = splitTextEvenly(text);
    const rejoinedLen = chunks.join(' ').length;
    // Allow tiny whitespace drift at sentence joins.
    expect(Math.abs(rejoinedLen - text.length)).toBeLessThan(chunks.length * 2);
  });

  it('handles empty / whitespace input', () => {
    expect(splitTextEvenly('')).toEqual([]);
    expect(splitTextEvenly('   \n  ')).toEqual([]);
  });

  it('a short point is returned unchanged as a single chunk', () => {
    const text = makeText(900);
    expect(splitTextEvenly(text)).toEqual([text]);
  });

  it('respects a custom idealSize', () => {
    const chunks = splitTextEvenly(makeText(3000), 1000);
    expect(chunks.length).toBe(3); // round(3000/1000)=3
  });
});
