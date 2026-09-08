import { act, renderHook, waitFor } from '@testing-library/react';

import { useTextDictation } from '@/hooks/useTextDictation';
import { UsageCapReachedError } from '@/services/usageLimits';
import { transcribeAudioWithRetry, TranscriptionClientError } from '@/utils/transcriptionRetryClient';

const mockRefresh = jest.fn();
let mockBlocked = false;
jest.mock('@/hooks/useAiUsage', () => ({ useAiUsage: () => ({ transcriptionBlocked: mockBlocked, refresh: mockRefresh }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/utils/transcriptionRetryClient', () => ({
  ...jest.requireActual('@/utils/transcriptionRetryClient'), transcribeAudioWithRetry: jest.fn(),
}));
const transcribe = jest.mocked(transcribeAudioWithRetry);
const blob = new Blob(['recording']);
const options = () => ({ onText: jest.fn(), onEmpty: jest.fn(), onError: jest.fn(), onStart: jest.fn() });
beforeEach(() => { transcribe.mockReset(); mockRefresh.mockReset().mockResolvedValue(undefined); mockBlocked = false; });

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
  [new Error('Transport stopped'), 'Transport stopped'],
  ['untyped failure', 'custom.fallback'],
  [new TranscriptionClientError([{ kind: 'server', status: 503, message: 'Raw server failure' }]), 'audio.transcribeError.server'],
])('retains recoverable audio for %s and discards it explicitly', async (error, message) => {
  transcribe.mockRejectedValue(error);
  const callbacks = options();
  const { result } = renderHook(() => useTextDictation({ ...callbacks, fallbackErrorKey: 'custom.fallback' }));
  act(() => result.current.complete(blob));
  await waitFor(() => expect(result.current.error).toBe(message));
  expect(callbacks.onError).toHaveBeenCalledWith(message);
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
  await waitFor(() => expect(result.current.error).toBe('errors.audioProcessing'));
});
