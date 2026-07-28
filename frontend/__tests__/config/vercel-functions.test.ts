import fs from 'fs';
import path from 'path';

/**
 * Гейт на maxDuration для AI-роутов.
 *
 * Почему СКАНЕР, а не список: поимённый список уже дважды протекал —
 * `compose-plan-from-scratch` упал в прод-таймаут 2026-07-25 («Task timed out
 * after 10 seconds»), а `insights/plan`, `generate-outline-points` и
 * `brainstorm` просидели на дефолтных 10 секундах незамеченными. Роут без
 * записи в vercel.json получает дефолт Hobby = 10s, при этом клиент по
 * category:'ai' ждёт 90s — спиннер крутится над убитым запросом.
 * Замер по боевой телеметрии (`ai_prompt_telemetry.latencyMs`): у AI-вызовов
 * медианы 1.4-7.7s, а p90 доходит до 38s и максимумы до 106s, то есть 10s
 * не хватает по построению. Поэтому список обязан выводиться из кода.
 */

const AI_SIGNALS =
  /callWithStructuredOutput|structuredOutput|openai|OpenAI|gemini|GoogleGenAI|GoogleGenerativeAI|consumeAiUsage|assertAiUsage/;

const MIN_DURATION_SECONDS = 60;

function collectRouteFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectRouteFiles(full);
    return entry.name === 'route.ts' ? [full] : [];
  });
}

function toConfigKey(absolutePath: string): string {
  return path.relative(process.cwd(), absolutePath).split(path.sep).join('/');
}

describe('vercel function duration config', () => {
  const vercelConfig = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8')
  ) as { functions?: Record<string, { maxDuration?: number }> };

  const aiRoutes = collectRouteFiles(path.join(process.cwd(), 'app', 'api'))
    .filter((file) => AI_SIGNALS.test(fs.readFileSync(file, 'utf8')))
    .map(toConfigKey)
    .sort();

  it('finds the AI routes to guard (сканер не должен молча вернуть пусто)', () => {
    expect(aiRoutes.length).toBeGreaterThan(10);
  });

  it(`every AI route declares maxDuration >= ${MIN_DURATION_SECONDS}`, () => {
    const underLimit = aiRoutes.filter(
      (route) => (vercelConfig.functions?.[route]?.maxDuration ?? 10) < MIN_DURATION_SECONDS
    );

    // Пустой массив = все AI-роуты укрыты. Непустой — вот именно эти сидят на
    // дефолтных 10 секундах: добавь их в vercel.json.
    expect(underLimit).toEqual([]);
  });

  it('vercel.json has no entries pointing at deleted files', () => {
    const dangling = Object.keys(vercelConfig.functions ?? {}).filter(
      (route) => !fs.existsSync(path.join(process.cwd(), route))
    );

    expect(dangling).toEqual([]);
  });

  // Именованные случаи оставлены как документация намерения: у этих роутов
  // причина потолка известна и записана.
  it.each([
    'app/api/studies/transcribe/route.ts',
    'app/api/thoughts/transcribe/route.ts',
  ])('allows enough runtime for %s to finish transcription plus polish', (route) => {
    expect(vercelConfig.functions?.[route]?.maxDuration).toBeGreaterThanOrEqual(60);
  });

  it.each([
    'app/api/sermons/[id]/compose-plan-from-scratch/route.ts',
    'app/api/insights/plan/route.ts',
  ])('allows enough runtime for %s to send the whole sermon to the LLM', (route) => {
    expect(vercelConfig.functions?.[route]?.maxDuration).toBeGreaterThanOrEqual(60);
  });
});
