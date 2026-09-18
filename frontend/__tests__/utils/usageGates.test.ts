import {
  USAGE_ACTION_RESOURCES,
  actionBlockedLabelKey,
  blockingResource,
  isActionBlocked,
} from '@/utils/usageGates';

/**
 * A GATE THAT NAMES ONE RESOURCE WHILE THE ACTION SPENDS TWO IS NOT A GATE.
 *
 * Every recorder in the app was disabled on `transcriptionBlocked` alone, while the routes
 * behind them — `/api/thoughts`, `/api/thoughts/transcribe`, `/api/studies/transcribe` — are
 * admitted for `['transcription', 'ai']`. With speech recognition untouched and the AI
 * allowance spent, the microphone stayed bright, the take went out, and the server refused it.
 */
describe('usage gates', () => {
  it('knows that dictation is paid for twice', () => {
    expect(USAGE_ACTION_RESOURCES.dictation).toEqual(['transcription', 'ai']);
    expect(isActionBlocked('dictation', { transcription: false, ai: true })).toBe(true);
    expect(isActionBlocked('dictation', { transcription: true, ai: false })).toBe(true);
    expect(isActionBlocked('dictation', { transcription: false, ai: false })).toBe(false);
  });

  it('knows that generating the spoken sermon is paid for twice', () => {
    expect(USAGE_ACTION_RESOURCES.audioGeneration).toEqual(['ai', 'audio']);
    expect(isActionBlocked('audioGeneration', { ai: false, audio: true })).toBe(true);
    expect(isActionBlocked('audioGeneration', { ai: true, audio: false })).toBe(true);
  });

  it('leaves a plain AI action answerable by the AI allowance alone', () => {
    expect(isActionBlocked('aiText', { ai: false, transcription: true, audio: true })).toBe(false);
    expect(isActionBlocked('aiText', { ai: true })).toBe(true);
  });

  it('names the allowance that actually ran out, so the words are not a guess', () => {
    expect(actionBlockedLabelKey('dictation', { transcription: false, ai: true }))
      .toBe('settings.usage.aiUsageExhausted');
    expect(actionBlockedLabelKey('dictation', { transcription: true, ai: false }))
      .toBe('settings.usage.transcriptionUsageExhausted');
    expect(actionBlockedLabelKey('audioGeneration', { ai: false, audio: true }))
      .toBe('settings.usage.audioUsageExhausted');
    expect(actionBlockedLabelKey('dictation', {})).toBeNull();
  });

  it('reports the first blocking resource in the action\'s own order', () => {
    // Both spent: the sentence should lead with transcription, which is what a recorder is for.
    expect(blockingResource('dictation', { transcription: true, ai: true })).toBe('transcription');
    expect(blockingResource('audioGeneration', { ai: true, audio: true })).toBe('ai');
  });

  it('treats an unknown answer as "not blocked", never as blocked', () => {
    // The allowance arrives from the server; before it does, the person must not be stopped.
    expect(isActionBlocked('dictation', { transcription: undefined, ai: undefined })).toBe(false);
  });
});
