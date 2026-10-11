import { act, renderHook, waitFor } from '@testing-library/react';

import { useTextDictation } from '@/hooks/useTextDictation';
import { UsageCapReachedError } from '@/services/usageLimits';
import { sayFailure } from '@/utils/actionFailureMessage';
import { diagnosticEvents } from '@/utils/appDiagnostics';
import { transcribeAudioWithRetry, TranscriptionClientError } from '@/utils/transcriptionRetryClient';

const mockRefresh = jest.fn();
let mockBlocked = false;
jest.mock('@/hooks/useAiUsage', () => ({
  useAiUsage: () => require('@test-utils/aiUsage').aiUsageStub({ transcriptionBlocked: mockBlocked, refresh: mockRefresh }),
}));
// English says the key; another language prefixes it, so a test can switch the language.
let mockLanguage = 'en';
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => (mockLanguage === 'en' ? key : `${mockLanguage}:${key}`) }) }));
jest.mock('@/utils/transcriptionRetryClient', () => ({
  ...jest.requireActual('@/utils/transcriptionRetryClient'), transcribeAudioWithRetry: jest.fn(),
}));
const transcribe = jest.mocked(transcribeAudioWithRetry);
const blob = new Blob(['recording']);
const options = () => ({ onText: jest.fn(), onEmpty: jest.fn(), onError: jest.fn(), onStart: jest.fn() });
beforeEach(() => { transcribe.mockReset(); mockRefresh.mockReset().mockResolvedValue(undefined); mockBlocked = false; mockLanguage = 'en'; });

it('publishes original text when polish is absent, refreshes usage after publishing, and exposes quota state', async () => {
  const callbacks = options();
  let complete!: (result: { polishedText: string; originalText: string }) => void;
  transcribe.mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
  const { result, rerender } = renderHook(() => useTextDictation(callbacks));
  act(() => result.current.complete(blob));
  expect(result.current.isProcessing).toBe(true);
  expect(callbacks.onStart).toHaveBeenCalledTimes(1);
  expect(result.current.maxRetries).toBe(3);
  act(() => result.current.stopProcessing());
  expect(result.current.isProcessing).toBe(false);
  await act(async () => { complete({ polishedText: '', originalText: '  Original speech  ' }); });
  expect(callbacks.onText).toHaveBeenCalledWith('Original speech');
  expect(callbacks.onText.mock.invocationCallOrder[0]).toBeLessThan(mockRefresh.mock.invocationCallOrder[0]);
  expect(callbacks.onError).not.toHaveBeenCalled();
  mockBlocked = true;
  rerender();
  expect(result.current.transcriptionBlocked).toBe(true);
});

it.each([
  [new Error('Transport stopped'), { key: 'custom.fallback' }],
  ['untyped failure', { key: 'custom.fallback' }],
  [new TranscriptionClientError([{ kind: 'server', status: 503, message: 'Raw server failure' }]), { key: 'audio.transcribeError.server' }],
])('retains recoverable audio for %s and discards it explicitly', async (error, words) => {
  transcribe.mockRejectedValue(error);
  const callbacks = options();
  const { result } = renderHook(() => useTextDictation({ ...callbacks, fallbackErrorKey: 'custom.fallback' }));
  act(() => result.current.complete(blob));
  await waitFor(() => expect(result.current.error).toEqual(words));
  expect(callbacks.onError).toHaveBeenCalledWith(words);
  expect(callbacks.onText).not.toHaveBeenCalled();
  expect(mockRefresh).not.toHaveBeenCalled();
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.isProcessing).toBe(false));
  expect(transcribe).toHaveBeenLastCalledWith(blob, { endpoint: '/api/thoughts/transcribe' });
  expect(result.current.retryCount).toBe(1);
  act(() => result.current.clear());
  expect(result.current.error).toBeNull();
  expect(result.current.retryCount).toBe(0);
  act(() => result.current.retry());
  expect(transcribe).toHaveBeenCalledTimes(2);
});

it('does not duplicate usage-cap reporting or offer an initial retry without recoverable audio', async () => {
  transcribe.mockRejectedValueOnce(new UsageCapReachedError('transcription', 10, 10, 10, 'tomorrow'));
  const callbacks = options();
  const { result } = renderHook(() => useTextDictation(callbacks));
  act(() => result.current.complete(blob));
  await waitFor(() => expect(result.current.isProcessing).toBe(false));
  expect(result.current.error).toBeNull();
  expect(callbacks.onError).not.toHaveBeenCalled();
  expect(callbacks.onText).not.toHaveBeenCalled();
  act(() => result.current.retry());
  expect(transcribe).toHaveBeenCalledTimes(1);
});

it('handles empty results without refreshing usage and allows callers with no optional reporters', async () => {
  transcribe.mockResolvedValueOnce({ polishedText: '', originalText: '' });
  const callbacks = { onText: jest.fn(), onEmpty: jest.fn() };
  const { result } = renderHook(() => useTextDictation(callbacks));
  act(() => result.current.complete(blob));
  await waitFor(() => expect(callbacks.onEmpty).toHaveBeenCalledTimes(1));
  expect(callbacks.onText).not.toHaveBeenCalled();
  expect(mockRefresh).not.toHaveBeenCalled();
  transcribe.mockRejectedValueOnce('untyped failure');
  act(() => result.current.complete(blob));
  await waitFor(() => expect(result.current.error).toEqual({ key: 'errors.audioProcessing' }));
});

it('keeps a failed transcription as words a recorder says in the language on screen', async () => {
  transcribe.mockRejectedValue(new TranscriptionClientError([
    { kind: 'network', status: 0, message: 'reset' }, { kind: 'network', status: 0, message: 'reset' },
  ]));
  const { result, rerender } = renderHook(() => useTextDictation(options()));
  act(() => result.current.complete(blob));
  await waitFor(() => expect(result.current.error).not.toBeNull());

  mockLanguage = 'uk';
  rerender();

  // What a recorder shows for the kept failure now: words are said with the current language.
  expect(sayFailure(result.current.error!, key => `uk:${key}`)).toBe('uk:audio.transcribeError.network uk:audio.transcribeError.billingHint');
});

// The technical report's path says that the person dictated and how it ended (owner, 2026-10-10).
it('leaves a dictation line in the technical report — the outcome and time, never the words', async () => {
  localStorage.clear();
  transcribe.mockResolvedValueOnce({ polishedText: 'Private sermon words', originalText: 'Private sermon words' } as never);
  const { result } = renderHook(() => useTextDictation(options()));
  await act(async () => { result.current.complete(blob); });
  const line = diagnosticEvents().filter(event => event.name === 'dictation').at(-1);
  expect(line?.data).toEqual({ source: 'field', result: 'text', elapsedMs: expect.any(Number) });
  expect(JSON.stringify(diagnosticEvents())).not.toContain('Private sermon words');
});
