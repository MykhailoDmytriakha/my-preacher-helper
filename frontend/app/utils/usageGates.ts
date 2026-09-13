import type { UsageResource } from '@/services/usageLimits';

/**
 * WHAT AN ACTION SPENDS — THE ONE PLACE THAT KNOWS.
 *
 * Every gate in the interface used to name a RESOURCE while the button fired a request that
 * admits two of them. Dictation is the clearest case: `/api/thoughts`, `/api/thoughts/transcribe`
 * and `/api/studies/transcribe` all admit `['transcription', 'ai']`, and every recorder in the
 * app was disabled on `transcriptionBlocked` alone. So with speech recognition untouched and the
 * AI allowance spent, the microphone stayed bright, the recording went out, and the server
 * refused it — the preacher lost the take and met an error for a rule the screen never showed.
 *
 * The cure is to ask about the ACTION instead. A caller says "can this person dictate" and the
 * answer is assembled here, from the same list the route admits, so the two cannot drift apart.
 * When a route starts spending another resource, this table is the single line to change.
 */
export type UsageAction = 'dictation' | 'aiText' | 'audioGeneration';

export const USAGE_ACTION_RESOURCES: Record<UsageAction, readonly UsageResource[]> = {
  /** Speech → text: transcription for the audio, AI for turning it into a thought. */
  dictation: ['transcription', 'ai'],
  /** Plans, sorting, insights, sketches, optimised text — AI only. */
  aiText: ['ai'],
  /** Spoken sermon export: AI writes the text, the audio allowance pays for the voice. */
  audioGeneration: ['ai', 'audio'],
};

export type BlockedResources = Partial<Record<UsageResource, boolean>>;

/**
 * Which resource stops this action — the first one in the action's own order, so the words on
 * screen name the thing that actually ran out rather than the one the component happened to
 * remember. Null means nothing stops it.
 */
export const blockingResource = (
  action: UsageAction,
  blocked: BlockedResources,
): UsageResource | null =>
  USAGE_ACTION_RESOURCES[action].find((resource) => blocked[resource] === true) ?? null;

export const isActionBlocked = (action: UsageAction, blocked: BlockedResources): boolean =>
  blockingResource(action, blocked) !== null;

const EXHAUSTED_KEY: Record<UsageResource, string> = {
  ai: 'settings.usage.aiUsageExhausted',
  transcription: 'settings.usage.transcriptionUsageExhausted',
  audio: 'settings.usage.audioUsageExhausted',
};

/** The sentence for why this action is unavailable, or null when it is available. */
export const actionBlockedLabelKey = (
  action: UsageAction,
  blocked: BlockedResources,
): string | null => {
  const resource = blockingResource(action, blocked);
  return resource ? EXHAUSTED_KEY[resource] : null;
};
