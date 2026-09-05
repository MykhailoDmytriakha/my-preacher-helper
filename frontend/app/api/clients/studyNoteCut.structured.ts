/**
 * CUT A STUDY NOTE INTO ATOMIC SCRATCH NOTES.
 *
 * The bridge from a study note to a sermon is NOT a plan: the preacher builds the plan
 * by hand on the scratch board. What the note gives the sermon is building material —
 * scratch notes that are atoms: one cornerstone claim each, in the author's own words,
 * with the Scripture it rests on, disposable without loss and needing no edit.
 *
 * The number of atoms is derived, never chosen: one per cornerstone claim, guided by a
 * corridor the note's length justifies (`noteCutCorridor.ts`). The model answers section
 * by section, so the count stays explainable to the person who reads the result.
 */
import { CutNoteResponseSchema, type CutNoteResponse, type CutNoteSection } from '@/config/schemas/zod';
import { isUsageCapReachedError } from '@/services/usageLimits';
import { expectedScratchCountCorridor } from '@/utils/noteCutCorridor';

import { logger } from './openAIHelpers';
import { buildSimplePromptBlueprint, detectDominantLanguage } from './promptBuilder';
import { callWithStructuredOutput, type StructuredOutputResult } from './structuredOutput';

export interface CutStudyNoteInput {
  content: string;
  title?: string;
  /** References the author attached to the note, already formatted for reading. */
  scriptureRefs?: string[];
  userId?: string;
  /**
   * Which part of the note this call is cutting, when the note is cut in slices. Told to
   * the model so it knows it is reading an excerpt and does not try to open or close the
   * whole argument inside one slice.
   */
  slice?: { from: number; to: number; total: number };
  /**
   * How long this call may take, in milliseconds, counted from now. The route lives under
   * a 60s serverless wall; the deadline is what makes a retry affordable — an attempt is
   * only started while enough of the budget is left to finish it.
   */
  budgetMs?: number;
}

export interface CutStudyNoteResult {
  success: boolean;
  data: CutNoteResponse | null;
  error: string | null;
}

const PROMPT_NAME = 'studies.note.cut_scratch';
const PROMPT_VERSION = 'v1';

function languageHintFor(text: string): string {
  if (/[їієґЇІЄҐ]/.test(text)) return 'Ukrainian';
  if (/[ыэъЫЭЪ]/.test(text)) return 'Russian';
  if (/[Ѐ-ӿ]/.test(text)) return 'Russian or Ukrainian';
  return 'the language of the note';
}

function countSections(content: string): number {
  return content.split('\n').filter((line) => /^#{1,6}\s+\S/.test(line.trim())).length;
}

export interface CutNoteSlice {
  /** 1-based, inclusive, as a person counts sections. */
  from: number;
  to: number;
  total: number;
}

export function buildCutNoteSystemPrompt(
  languageHint: string,
  corridor: { min: number; max: number },
  slice?: CutNoteSlice
): string {
  const excerpt = slice && slice.total > (slice.to - slice.from + 1);
  return [
    "You are cutting a preacher's study note into scratch notes for a sermon.",
    '',
    'THE UNIT. One scratch note = one cornerstone claim: a thought the preacher can say from the pulpit on its own. Every scratch note must be:',
    "- self-sufficient: the claim in the author's own words (one to three sentences, cut and trimmed — never paraphrased, never summarised), followed by what it rests on: the Scripture quotation exactly as the note quotes it, with the reference in parentheses, or the example or image the note uses;",
    '- disposable: dropping it loses nothing elsewhere — scratch notes must not depend on each other;',
    '- final: it needs no editing. If you feel the urge to rewrite, the cut is wrong: two claims are stuck together, or the support was cut off.',
    '',
    'HOW TO CUT. Go section by section in document order. In each section first find the claims, then write them out.',
    '- A NEW scratch note starts where a new claim begins that can be said on its own and has its own support (a verse, an example, an image).',
    '- A paragraph that only develops the previous claim belongs to the same scratch note.',
    '- A claim that repeats an earlier one from another angle is merged into the earlier one. Never emit duplicates.',
    '- Transitions, context, "let us look at", lists of names without a claim of their own: no scratch note.',
    '- Never a scratch note: a heading; a summary of a section; a whole paragraph copied; a fact without a claim.',
    '',
    `HOW MANY. The count is derived, not chosen: one scratch note per cornerstone claim. For a note of this length expect roughly ${corridor.min}–${corridor.max}. Land outside that only when the note truly holds more or fewer cornerstone claims; never pad to reach a number and never merge distinct claims to fit one.`,
    '',
    `LANGUAGE AND WORDS. Write in ${languageHint}. Use the author's own sentences: you may trim and join, you may not invent. Keep the note's own Scripture wording and its way of writing references.`,
    '',
    excerpt
      ? `YOU ARE READING AN EXCERPT: sections ${slice.from}-${slice.to} of ${slice.total}. Cut what is in front of you and nothing else — do not open or conclude the whole note here, do not refer to sections you cannot see, and do not leave a claim out because you assume another part of the note covers it.`
      : null,
    excerpt ? '' : null,
    "KEY PASSAGE. Name the single passage this text is built on, as a reference in the note's language, or an empty string.",
    '',
    'OUTPUT. Every section of the text you were given, in order, each with its heading (without # marks, empty for text before the first heading) and its claims — possibly none. Each claim carries `text` (the preachable scratch note) and `scripture` (its references as the note writes them, or an empty string).',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

export function buildCutNoteUserMessage(input: CutStudyNoteInput, corridor: { min: number; max: number }): string {
  const parts: string[] = [];
  parts.push(`Title: ${input.title?.trim() || '(untitled)'}`);
  if (input.scriptureRefs && input.scriptureRefs.length > 0) {
    parts.push(`Scripture references the author attached: ${input.scriptureRefs.join('; ')}`);
  }
  if (input.slice && input.slice.total > input.slice.to - input.slice.from + 1) {
    parts.push(`This is part of the note: sections ${input.slice.from}-${input.slice.to} of ${input.slice.total}.`);
  }
  parts.push(`Length of this text: ${input.content.length} characters, ${countSections(input.content)} headed sections.`);
  parts.push(`Suggested count for this text: ${corridor.min}–${corridor.max} scratch notes.`);
  parts.push('');
  parts.push(input.slice ? 'TEXT TO CUT:' : 'NOTE:');
  parts.push(input.content);
  return parts.join('\n');
}

/** Drop empty claims and sections the model invented, keep document order. */
export function normalizeCutSections(sections: CutNoteSection[]): CutNoteSection[] {
  return sections.map((section) => ({
    heading: section.heading.trim(),
    claims: section.claims
      .map((claim) => ({ text: claim.text.trim(), scripture: claim.scripture.trim() }))
      .filter((claim) => claim.text.length > 0),
  }));
}

/**
 * A FAILURE WORTH A SECOND ATTEMPT — the provider was unavailable, rate-limited or the
 * connection died, none of which says anything about the note. A refusal, a bad schema or
 * a rejected key is terminal: trying again would burn the person's minute for nothing.
 */
function isWorthRetrying(error: Error | null): boolean {
  if (!error) return false;
  const text = `${error.message} ${(error as { status?: unknown }).status ?? ''}`.toLowerCase();
  return (
    /\b(429|500|502|503|504)\b/.test(text) ||
    text.includes('timeout') ||
    text.includes('timed out') ||
    text.includes('econnreset') ||
    text.includes('socket hang up') ||
    text.includes('network') ||
    text.includes('overloaded') ||
    text.includes('rate limit')
  );
}

/** Time the whole call may take when the caller did not say — one slice under a 60s wall. */
const DEFAULT_BUDGET_MS = 50_000;
/** No attempt is started with less than this left: a doomed attempt is worse than none. */
const MIN_ATTEMPT_MS = 12_000;
/** A single attempt never waits longer than this, however much budget is left. */
const MAX_ATTEMPT_MS = 30_000;
const RETRY_BACKOFF_MS = 700;

export async function cutStudyNoteIntoScratch(input: CutStudyNoteInput): Promise<CutStudyNoteResult> {
  const content = input.content.trim();
  if (!content) {
    return { success: false, data: null, error: 'Note content is empty' };
  }

  const languageHint = languageHintFor(content);
  const telemetryExpectedLanguage = detectDominantLanguage(content);
  const corridor = expectedScratchCountCorridor(content);

  logger.debug('CutStudyNote', 'Starting cut', {
    contentLength: content.length,
    languageHint,
    corridor,
  });

  try {
    const systemPrompt = buildCutNoteSystemPrompt(languageHint, corridor, input.slice);
    const userMessage = buildCutNoteUserMessage({ ...input, content }, corridor);
    const promptBlueprint = buildSimplePromptBlueprint({
      promptName: PROMPT_NAME,
      promptVersion: PROMPT_VERSION,
      expectedLanguage: telemetryExpectedLanguage === 'unknown' ? null : telemetryExpectedLanguage,
      systemPrompt,
      userMessage,
      context: {
        contentLength: content.length,
        languageHint,
        corridorMin: corridor.min,
        corridorMax: corridor.max,
      },
    });

    /**
     * ONE ATTEMPT, THEN ANOTHER WHILE THE BUDGET ALLOWS.
     *
     * The SDK's own defaults — a 10-minute timeout and two hidden retries — would let a
     * stalled provider outlive the function, so they stay off and the retry is ours: we
     * know how much of the 60s wall is left and only start an attempt that can finish
     * inside it. This exists because a single `503 (no body)` from the provider threw
     * away 36 seconds of the person's waiting with nothing to show for it, and because
     * the shared fallback chain does not retry a target — it only moves to the next one,
     * and an ordinary tier has exactly one.
     *
     * A failed attempt costs no quota: usage is consumed only on a successful call.
     */
    const deadline = Date.now() + (input.budgetMs ?? DEFAULT_BUDGET_MS);
    let result: StructuredOutputResult<CutNoteResponse>;
    let attempt = 0;
    for (;;) {
      attempt += 1;
      const remaining = deadline - Date.now();
      const timeout = Math.min(MAX_ATTEMPT_MS, Math.max(MIN_ATTEMPT_MS, remaining - 1_000));
      result = await callWithStructuredOutput(
        promptBlueprint.systemPrompt,
        promptBlueprint.userMessage,
        CutNoteResponseSchema,
        {
          formatName: 'cutNote',
          userId: input.userId,
          promptBlueprint,
          logContext: { contentLength: content.length, languageHint, attempt },
          requestOptions: { timeout, maxRetries: 0 },
        }
      );
      if (result.data || !isWorthRetrying(result.error)) break;
      if (deadline - Date.now() < MIN_ATTEMPT_MS + RETRY_BACKOFF_MS) {
        logger.warn('CutStudyNote', `Transient failure with no budget left to retry: ${result.error?.message}`);
        break;
      }
      logger.warn('CutStudyNote', `Attempt ${attempt} failed transiently, retrying: ${result.error?.message}`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS));
    }

    if (result.refusal) {
      logger.warn('CutStudyNote', `Model refused: ${result.refusal}`);
      return { success: false, data: null, error: `AI refused to cut the note: ${result.refusal}` };
    }
    if (result.error || !result.data) {
      const message = result.error?.message ?? 'No data received from AI';
      logger.error('CutStudyNote', message);
      return { success: false, data: null, error: message };
    }

    const sections = normalizeCutSections(result.data.sections ?? []);
    const total = sections.reduce((sum, section) => sum + section.claims.length, 0);
    logger.debug('CutStudyNote', 'Cut complete', { sections: sections.length, claims: total, corridor });

    return {
      success: true,
      data: { keyPassage: (result.data.keyPassage ?? '').trim(), sections },
      error: null,
    };
  } catch (error) {
    // Usage-cap errors must reach the route untouched: it turns them into a 429 the
    // client understands. Everything else is reported as a failed cut.
    if (isUsageCapReachedError(error)) {
      throw error;
    }
    const message = error instanceof Error ? error.message : 'Unknown error while cutting the note';
    logger.error('CutStudyNote', message);
    return { success: false, data: null, error: message };
  }
}
