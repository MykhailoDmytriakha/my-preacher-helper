import { act, renderHook, waitFor } from '@testing-library/react';

import { useTextDictation } from '@/hooks/useTextDictation';
import { UsageCapReachedError } from '@/services/usageLimits';
import { transcribeAudioWithRetry } from '@/utils/transcriptionRetryClient';

const mockRows = new Map<string, unknown>();
let mockWriteError: Error | null = null;
jest.mock('idb-keyval', () => ({
  createStore: jest.fn(() => ({})),
  get: jest.fn(async (id: string) => mockRows.get(id)),
  entries: jest.fn(async () => Array.from(mockRows.entries())),
  update: jest.fn(async (id: string, change: (old: unknown) => unknown) => {
    if (mockWriteError) throw mockWriteError;
    mockRows.set(id, change(mockRows.get(id)));
  }),
}));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'alice' }, loading: false }) }));
jest.mock('@/hooks/useAiUsage', () => ({
  useAiUsage: () => require('@test-utils/aiUsage').aiUsageStub({ refresh: jest.fn().mockResolvedValue(undefined) }),
}));
jest.mock('@/utils/transcriptionRetryClient', () => ({
  ...jest.requireActual('@/utils/transcriptionRetryClient'), transcribeAudioWithRetry: jest.fn(),
}));
const transcribe = jest.mocked(transcribeAudioWithRetry);
const blob = new Blob(['unfinished speech'], { type: 'audio/webm' });
const contextId = 'sermon-a:thought-a';
const options = () => Object.assign({
  onText: jest.fn(), onEmpty: jest.fn(), onError: jest.fn(),
}, { recordingContext: { context: 'thought' as const, contextId } });
const kept = () => Array.from(mockRows.values()).filter(value => value && typeof value === 'object' && 'blob' in value);
beforeEach(() => {
  mockRows.clear(); mockWriteError = null; transcribe.mockReset();
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: {} });
});

it('has durably scoped the raw source before asking the transcription provider', async () => {
  transcribe.mockReturnValue(new Promise(() => undefined));
  const view = renderHook(() => useTextDictation(options()));
  act(() => view.result.current.complete(blob));
  await waitFor(() => expect(transcribe).toHaveBeenCalledTimes(1));
  expect(kept().length).toBe(1);
  const row = kept()[0] as { ownerId: string; contextId: string };
  expect(row.ownerId).toBe('alice');
  expect(row.contextId).toBe(contextId);
  view.unmount();
  expect(kept().length).toBe(1);
});

it('retains the raw source after text appears locally until the field save accepts it', async () => {
  transcribe.mockResolvedValue({ originalText: 'Words waiting for Save', polishedText: '' } as never);
  const callbacks = options();
  const view = renderHook(() => useTextDictation(callbacks));
  act(() => view.result.current.complete(blob));
  await waitFor(() => expect(callbacks.onText).toHaveBeenCalledWith('Words waiting for Save', expect.any(String)));
  expect(kept().length).toBe(1);
  view.unmount();
  expect(kept().length).toBe(1);
});

it('does not lose a take whose transcription result is empty', async () => {
  transcribe.mockResolvedValue({ originalText: '', polishedText: '' } as never);
  const callbacks = options();
  const view = renderHook(() => useTextDictation(callbacks));
  act(() => view.result.current.complete(blob));
  await waitFor(() => expect(callbacks.onEmpty).toHaveBeenCalledTimes(1));
  expect(kept().length).toBe(1);
});

it('keeps the take when an account has used its transcription allowance', async () => {
  transcribe.mockRejectedValue(new UsageCapReachedError('transcription', 10, 10, 10, 'tomorrow'));
  const view = renderHook(() => useTextDictation(options()));
  act(() => view.result.current.complete(blob));
  await waitFor(() => expect(view.result.current.isProcessing).toBe(false));
  expect(kept().length).toBe(1);
});

it('does not send audio after the device refused to preserve its only source', async () => {
  mockWriteError = new Error('Device storage refused this source');
  transcribe.mockResolvedValue({ originalText: 'Not safely held', polishedText: '' } as never);
  const callbacks = options();
  const view = renderHook(() => useTextDictation(callbacks));
  act(() => view.result.current.complete(blob));
  await waitFor(() => expect(view.result.current.isProcessing).toBe(false));
  expect(transcribe).not.toHaveBeenCalled();
  expect(callbacks.onText).not.toHaveBeenCalled();
  expect(view.result.current.error).not.toBeNull();
  expect(view.result.current.canChangeDestination()).toBe(false);
});

it('releases only the takes included when a save started, keeping later words recoverable', async () => {
  transcribe.mockResolvedValue({ originalText: 'First fragment', polishedText: '' } as never);
  const callbacks = options();
  const view = renderHook(() => useTextDictation(callbacks));
  act(() => view.result.current.complete(blob));
  await waitFor(() => expect(view.result.current.isProcessing).toBe(false));
  const controller = view.result.current as typeof view.result.current & { captureAcceptance?: () => () => Promise<void> };
  expect(typeof controller.captureAcceptance).toBe('function');
  const acceptFirst = controller.captureAcceptance!();
  transcribe.mockResolvedValue({ originalText: 'Later fragment', polishedText: '' } as never);
  act(() => view.result.current.complete(new Blob(['later source'])));
  await waitFor(() => expect(callbacks.onText).toHaveBeenCalledWith('Later fragment', expect.any(String)));
  await act(async () => { await acceptFirst(); });
  const remaining = kept() as { transcript: string }[];
  expect(remaining.map(row => row.transcript)).toEqual(['Later fragment']);
});

it('uses the original study transcription endpoint with the same durable field contract', async () => {
  transcribe.mockResolvedValue({ originalText: 'Study words', polishedText: '' } as never);
  const callbacks = Object.assign(options(), { endpoint: '/api/studies/transcribe' });
  const view = renderHook(() => useTextDictation(callbacks));
  act(() => view.result.current.complete(blob));
  await waitFor(() => expect(callbacks.onText).toHaveBeenCalledWith('Study words', expect.any(String)));
  expect(transcribe).toHaveBeenCalledWith(blob, { endpoint: '/api/studies/transcribe' });
});

it('does not insert a late transcript after the person discarded that recording elsewhere', async () => {
  let answer!: (value: { originalText: string; polishedText: string }) => void;
  transcribe.mockReturnValue(new Promise(resolve => { answer = resolve; }));
  const callbacks = options();
  const view = renderHook(() => useTextDictation(callbacks));
  act(() => view.result.current.complete(blob));
  await waitFor(() => expect(transcribe).toHaveBeenCalledTimes(1));
  const source = kept()[0] as { id: string };
  const store = await import('@/utils/recordingDraftStore');
  await act(async () => { await store.deleteRecordingDraft(source.id, 'alice'); });
  await act(async () => { answer({ originalText: 'Discarded words', polishedText: '' }); });
  expect(callbacks.onText).not.toHaveBeenCalled();
  expect(kept()).toHaveLength(0);
});

it('releases a durably staged transcript even if its field unmounts before staging resolves', async () => {
  let staged!: () => void;
  const persistence = new Promise<void>(resolve => { staged = resolve; });
  transcribe.mockResolvedValue({ originalText: 'Durable words', polishedText: '' } as never);
  const callbacks = Object.assign(options(), { acceptAfterText: true, onText: jest.fn(() => persistence) });
  const view = renderHook(() => useTextDictation(callbacks));
  act(() => view.result.current.complete(blob));
  await waitFor(() => expect(callbacks.onText).toHaveBeenCalledTimes(1));
  expect(kept()).toHaveLength(1);
  view.unmount();
  await act(async () => { staged(); await persistence; });
  expect(kept()).toHaveLength(0);
});

it('retries a failed transcript-cache write before publishing and reuses it after remount', async () => {
  transcribe.mockImplementationOnce(async () => { mockWriteError = new Error('Transcript cache refused'); return { originalText: 'Cached once', polishedText: '' } as never; });
  const first = options(); const view = renderHook(() => useTextDictation(first));
  act(() => view.result.current.complete(blob));
  await waitFor(() => expect(view.result.current.error).not.toBeNull());
  expect(first.onText).not.toHaveBeenCalled(); mockWriteError = null;
  act(() => view.result.current.retry());
  await waitFor(() => expect(first.onText).toHaveBeenCalledTimes(1));
  const saved = kept()[0] as import('@/utils/recordingDraftStore').RecordingDraft;
  expect(saved.transcript).toBe('Cached once'); view.unmount();
  const next = options(); const returned = renderHook(() => useTextDictation(next));
  await act(async () => { await returned.result.current.recover(saved); });
  expect(next.onText).toHaveBeenCalledWith('Cached once', saved.id);
  expect(transcribe).toHaveBeenCalledTimes(1);
});

it('recovers only the exact new-study source linked to this created note', async () => {
  const draft: import('@/utils/recordingDraftStore').RecordingDraft = { id: 'linked-study-source', ownerId: 'alice', context: 'study', contextId: 'new', blob, mimeType: blob.type, sizeBytes: blob.size, createdAt: 10, transcript: 'Waiting study words' };
  mockRows.set(draft.id, draft);
  const callbacks = Object.assign(options(), { recordingContext: { context: 'study' as const, contextId: 'created-note' }, linkedSourceIds: [draft.id] });
  const view = renderHook(() => useTextDictation(callbacks));
  await act(async () => { await view.result.current.recover(draft); });
  expect(callbacks.onText).toHaveBeenCalledWith(draft.transcript, draft.id);
  await act(async () => { await view.result.current.recover({ ...draft, id: 'unrelated-source' }); });
  expect(callbacks.onText).toHaveBeenCalledTimes(1); expect(transcribe).not.toHaveBeenCalled();
});
