import fs from 'fs';
import path from 'path';

describe('vercel function duration config', () => {
  const vercelConfig = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8')
  ) as { functions?: Record<string, { maxDuration?: number }> };

  it.each([
    'app/api/studies/transcribe/route.ts',
    'app/api/thoughts/transcribe/route.ts',
  ])('allows enough runtime for %s to finish transcription plus polish', (route) => {
    expect(vercelConfig.functions?.[route]?.maxDuration).toBeGreaterThanOrEqual(60);
  });
});
