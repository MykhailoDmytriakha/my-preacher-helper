import { Insights } from '@/models/models';
import { isUsageCapReachedError } from '@/services/usageLimits';
import { apiClient } from '@/utils/apiClient';
import { getAuthenticatedRequestHeaders } from '@/utils/authenticatedRequest';
import { FetchTimeoutError } from '@/utils/fetchWithTimeout';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE;

/** What went wrong, in terms a person can act on. */
export type AiInsightFailure = 'too-large' | 'unavailable';

/**
 * A refusal that REACHES the person.
 *
 * These generators used to answer every failure with `null`. The caller then had
 * nothing to show and nothing to say, so a provider error, an exhausted quota or a
 * request killed by the 60s function ceiling all looked identical on screen: the
 * suggestions block simply did not appear, as if there had been nothing to suggest.
 * The only trace was a console line the person never sees.
 */
export class AiInsightError extends Error {
  readonly reason: AiInsightFailure;

  constructor(reason: AiInsightFailure, detail: string) {
    super(detail);
    this.name = 'AiInsightError';
    this.reason = reason;
  }
}

/**
 * A request that ran out of time was not "broken" — it was TOO BIG for one call.
 * That distinction is the whole point of carrying a reason: one case asks the
 * person to split the text, the other asks them to try again.
 */
/**
 * ⚠️ "Too large" is a claim about the INPUT, and nothing here measures the input.
 * A stalled connection and an overloaded route also run out of time, so calling
 * every timeout "too large" prescribes an action ("split the sermon") that may be
 * useless. Only a payload the server itself rejected as oversized is certain; the
 * timeout family says "did not fit in the time it had", which is true either way
 * and is what the message must therefore say.
 */
function classify(error: unknown, status?: number): AiInsightFailure {
  if (status === 413) return 'too-large';
  if (error instanceof FetchTimeoutError) return 'too-large';
  if (status === 408 || status === 504) return 'too-large';
  return 'unavailable';
}

async function requestInsights(
  label: string,
  sermonId: string,
  path: string
): Promise<Insights> {
  let status: number | undefined;
  try {
    const authHeaders = await getAuthenticatedRequestHeaders();
    const response = await apiClient(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      category: 'ai'
    });
    status = response.status;

    if (!response.ok) {
      throw new Error(`${label}: response not ok for sermon ${sermonId}, status ${response.status}`);
    }

    /**
     * A 200 with NO insights object at all is not a result — the promise says it
     * resolves to `Insights`, and handing back `undefined` makes that a lie.
     *
     * ⚠️ But the check stops there, deliberately. A stricter version rejected a
     * response whose sections were merely EMPTY, and that put the screen at odds
     * with the database: the route persists what it got BEFORE answering, so a
     * blank-but-valid plan was already saved while the client called it a failure
     * and kept showing the old one — which then vanished on the next reload. Where
     * the server has already committed, the client's job is to show what was
     * committed, not to overrule it. Rejecting blank content belongs on the route,
     * before it writes; tracked separately.
     */
    const data = (await response.json()) as { insights?: Insights } | null;
    const insights = data?.insights;
    if (!insights) {
      throw new AiInsightError('unavailable', `${label}: response carried no insights`);
    }
    return insights;
  } catch (error) {
    /**
     * An exhausted quota ALREADY has its own channel and its own message — the
     * global handler shows how much is left and when it resets. Wrapping it here
     * would hand the person two contradictory toasts at once: "quota exhausted"
     * and "could not generate this, try again". So it travels on untouched.
     */
    if (error instanceof AiInsightError || isUsageCapReachedError(error)) throw error;
    console.error(`${label}: error generating for sermon ${sermonId}:`, error);
    throw new AiInsightError(classify(error, status), String(error));
  }
}

/** Generates the full insights set for a sermon. Throws AiInsightError on failure. */
export const generateInsights = (sermonId: string): Promise<Insights> =>
  requestInsights('generateInsights', sermonId, `/api/insights?sermonId=${sermonId}`);

/** Generates only topics. Throws AiInsightError on failure. */
export const generateTopics = (sermonId: string): Promise<Insights> =>
  requestInsights('generateTopics', sermonId, `/api/insights/topics?sermonId=${sermonId}`);

/** Generates only related verses. Throws AiInsightError on failure. */
export const generateRelatedVerses = (sermonId: string): Promise<Insights> =>
  requestInsights('generateRelatedVerses', sermonId, `/api/insights/verses?sermonId=${sermonId}`);

/** Generates only possible directions. Throws AiInsightError on failure. */
export const generatePossibleDirections = (sermonId: string): Promise<Insights> =>
  requestInsights('generatePossibleDirections', sermonId, `/api/insights/directions?sermonId=${sermonId}`);

/** Generates the thoughts-based plan. Throws AiInsightError on failure. */
export const generateThoughtsBasedPlan = (sermonId: string): Promise<Insights> =>
  requestInsights('generateThoughtsBasedPlan', sermonId, `/api/insights/plan?sermonId=${sermonId}`);
