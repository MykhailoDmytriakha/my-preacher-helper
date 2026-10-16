import { act, renderHook } from '@testing-library/react';

import { usePreparedSpeech } from '@/hooks/usePreparedSpeech';
import { apiClient } from '@/utils/apiClient';

import type { Sermon } from '@/models/models';
import type { PreparedAudioSet } from '@/types/audioGeneration.types';

jest.mock('@/utils/apiClient', () => ({ apiClient: jest.fn() }));
jest.mock('@/utils/authenticatedRequest', () => ({ getAuthenticatedRequestHeaders: jest.fn().mockResolvedValue({}) }));

const makeSource = (id: string, text: string, revision = 1): PreparedAudioSet => ({
  id, revision, sections: ['introduction'], chunks: [{ index: 0, sectionId: 'introduction', text, createdAt: '2026-10-01' }],
});
const reply = (sources: Record<string, PreparedAudioSet>) => ({ ok: true, json: async () => ({ sources }) });
const deferred = () => { let resolve!: (value: unknown) => void; const promise = new Promise(resolveValue => { resolve = resolveValue; }); return { promise, resolve }; };
const options = (extra = {}) => ({
  owner: 'owner', sermonId: 'sermon', sermon: { audioSources: { ai: makeSource('saved-ai', 'Saved AI correction') }, audioMetadata: { mode: 'ai' } } as unknown as Sermon,
  provider: 'openai' as const, sections: ['introduction'] as ('introduction')[],
  requestPreparation: (body: Record<string, unknown>, headers: Record<string, string>) => apiClient('/api/sermons/sermon/audio/optimize', { method: 'POST', body: JSON.stringify(body), headers }),
  requestCorrection: (index: number, body: Record<string, unknown>, headers: Record<string, string>) => apiClient('/api/sermons/sermon/audio/chunks/' + index, { method: 'PUT', body: JSON.stringify(body), headers }),
  setSections: jest.fn(), setError: jest.fn(), aiBlocked: false, refreshUsage: jest.fn().mockResolvedValue(undefined), ...extra,
});

describe('usePreparedSpeech authored source lifecycle', () => {
  beforeEach(() => jest.clearAllMocks());

  it('prepares Original when AI quota is blocked without spending AI usage', async () => {
    const props = options({ aiBlocked: true });
    (apiClient as jest.Mock).mockResolvedValue(reply({ raw: makeSource('raw-first', 'Original words') }));
    const { result } = renderHook(() => usePreparedSpeech(props));
    await act(async () => result.current.selectSource('raw'));
    expect(apiClient).toHaveBeenCalledWith('/api/sermons/sermon/audio/optimize', expect.objectContaining({ body: expect.stringContaining('"useRawText":true') }));
    expect(result.current.chunks[0]?.text).toBe('Original words');
    expect(props.refreshUsage).not.toHaveBeenCalled();
  });

  it('does not prepare AI text when AI quota is blocked', async () => {
    const props = options({ aiBlocked: true });
    const { result } = renderHook(() => usePreparedSpeech(props));
    await act(async () => result.current.prepareSource('ai'));
    expect(apiClient).not.toHaveBeenCalled();
    expect(result.current.chunks[0].text).toBe('Saved AI correction');
  });

  it('reconciles a late inactive source without changing the newer selection or sections', async () => {
    const pending = deferred(), props = options();
    (apiClient as jest.Mock).mockReturnValue(pending.promise);
    const { result } = renderHook(() => usePreparedSpeech(props));
    let preparation!: Promise<void>;
    act(() => { preparation = result.current.selectSource('raw'); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => result.current.selectSource('ai'));
    const sectionsCalls = props.setSections.mock.calls.length;
    await act(async () => { pending.resolve(reply({ raw: makeSource('raw-ready', 'Original retained') })); await preparation; });
    expect(result.current.mode).toBe('ai');
    expect(result.current.chunks[0].text).toBe('Saved AI correction');
    expect(result.current.sources.raw?.chunks[0].text).toBe('Original retained');
    expect(props.setSections).toHaveBeenCalledTimes(sectionsCalls);
    await act(async () => result.current.selectSource('raw'));
    expect(result.current.chunks[0].text).toBe('Original retained');
    expect(apiClient).toHaveBeenCalledTimes(1);
  });

  it('does not let a late preparation replace a newer acknowledged correction', async () => {
    const pending = deferred(), props = options();
    (apiClient as jest.Mock).mockReturnValue(pending.promise);
    const { result } = renderHook(() => usePreparedSpeech(props));
    let preparation!: Promise<void>;
    act(() => { preparation = result.current.prepareSource('ai'); });
    await act(async () => { await Promise.resolve(); });
    act(() => result.current.reconcile({ sources: { ai: makeSource('new-ai', 'New correction', 4) } }));
    await act(async () => { pending.resolve(reply({ ai: makeSource('new-ai', 'Older prepared words', 3) })); await preparation; });
    expect(result.current.chunks[0].text).toBe('New correction');
  });

  it('does not publish a previous sermon response into the newly opened sermon', async () => {
    const pending = deferred(), first = options(), second = options({ sermonId: 'other', sermon: { audioSources: { ai: makeSource('other-ai', 'Other sermon') } } as unknown as Sermon });
    (apiClient as jest.Mock).mockReturnValue(pending.promise);
    const { result, rerender } = renderHook(props => usePreparedSpeech(props), { initialProps: first });
    let preparation!: Promise<void>;
    act(() => { preparation = result.current.prepareSource('ai'); });
    await act(async () => { await Promise.resolve(); });
    rerender(second);
    await act(async () => { pending.resolve(reply({ ai: makeSource('first-ai', 'Previous sermon answer', 9) })); await preparation; });
    expect(result.current.chunks[0].text).toBe('Other sermon');
    expect(result.current.isLoading).toBe(false);
  });

  it('keeps a newly opened editor when an earlier editor save finishes', async () => {
    const pending = deferred(), props = options();
    (apiClient as jest.Mock).mockReturnValue(pending.promise);
    const { result } = renderHook(() => usePreparedSpeech(props));
    act(() => result.current.openChunk(result.current.chunks[0]));
    let save!: Promise<void>;
    act(() => { save = result.current.saveChunk(0, 'First saved edit'); });
    await act(async () => { await Promise.resolve(); });
    act(() => result.current.closeChunk());
    act(() => result.current.openChunk(result.current.chunks[0]));
    const newSession = result.current.editingSession;
    await act(async () => { pending.resolve(reply({ ai: makeSource('saved-ai', 'First saved edit', 2) })); await save; });
    expect(result.current.chunks[0].text).toBe('First saved edit');
    expect(result.current.editingSession).toBe(newSession);
    expect(result.current.editingChunk).not.toBeNull();
  });
  it('merges a retired conflict without replacing the newer request error state', async () => {
    const older = deferred(), newer = deferred(), props = options();
    (apiClient as jest.Mock).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const { result } = renderHook(() => usePreparedSpeech(props));
    let first!: Promise<void>, second!: Promise<void>;
    act(() => { first = result.current.prepareSource('ai'); });
    await act(async () => { await Promise.resolve(); });
    act(() => { second = result.current.prepareSource('ai'); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { newer.resolve(reply({ ai: makeSource('new-ai', 'New accepted text', 2) })); await second; });
    props.setError.mockClear();
    await act(async () => { older.resolve({ ok: false, status: 409, json: async () => ({ code: 'chunks-changed', sources: { ai: makeSource('new-ai', 'Latest stored correction', 3) } }) }); await first; });
    expect(result.current.chunks[0].text).toBe('Latest stored correction');
    expect(result.current.isLoading).toBe(false);
    expect(props.setError).not.toHaveBeenCalled();
  });

});
