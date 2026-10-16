import { act, renderHook, waitFor } from '@testing-library/react';

import { usePreparedSpeech } from '@/hooks/usePreparedSpeech';
import { apiClient } from '@/utils/apiClient';
import { getAuthenticatedRequestHeaders } from '@/utils/authenticatedRequest';

import type { Sermon } from '@/models/models';
import type { PreparedAudioSet } from '@/types/audioGeneration.types';

jest.mock('@/utils/apiClient', () => ({ apiClient: jest.fn() }));
jest.mock('@/utils/authenticatedRequest', () => ({ getAuthenticatedRequestHeaders: jest.fn().mockResolvedValue({}) }));

const makeSource = (id: string, text: string, revision = 1): PreparedAudioSet => ({
  id, revision, sections: ['introduction'], chunks: [{ index: 0, sectionId: 'introduction', text, createdAt: '2026-10-01' }],
});
const twoChunkSource = (id: string, revision: number, target: string, sibling: string): PreparedAudioSet => ({
  id, revision, sections: ['introduction'], chunks: [
    { index: 0, sectionId: 'introduction', text: target, createdAt: '2026-10-01' },
    { index: 1, sectionId: 'introduction', text: sibling, createdAt: '2026-10-01' },
  ],
});
const reply = (sources: Record<string, PreparedAudioSet>) => ({ ok: true, json: async () => ({ sources }) });
const conflictReply = (mode: 'ai' | 'raw', sources: Record<string, PreparedAudioSet>, chunks: unknown[] = []) => ({
  ok: false, status: 409, json: async () => ({ code: 'chunks-changed', mode, sources, chunks }),
});
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

  it('resolves a source conflict using the displayed revision and complete displayed chunk set', async () => {
    const opening = twoChunkSource('saved-ai', 1, 'Target text', 'Opening sibling');
    const displayed = twoChunkSource('saved-ai', 2, 'Target text', 'Remote sibling correction');
    const accepted = twoChunkSource('saved-ai', 3, 'Resolved target', 'Remote sibling correction');
    const props = options({ sermon: { audioSources: { ai: opening }, audioMetadata: { mode: 'ai' } } as unknown as Sermon });
    (apiClient as jest.Mock).mockResolvedValueOnce(conflictReply('ai', { ai: displayed })).mockResolvedValueOnce(reply({ ai: accepted }));
    const { result } = renderHook(() => usePreparedSpeech(props));
    act(() => result.current.openChunk(result.current.chunks[0]));
    let first!: Promise<void>;
    act(() => { first = result.current.saveChunk(0, 'Candidate text').catch(() => undefined); });
    await act(async () => { await first; });

    const decision = result.current.editingConflict!;
    expect(decision.source).toEqual(displayed);
    expect(decision.targetIndex).toBe(0);
    await act(async () => { await result.current.resolveChunk(decision, 0, 'Resolved target'); });

    const [, request] = (apiClient as jest.Mock).mock.calls[1];
    expect(JSON.parse(request.body)).toEqual({
      text: 'Resolved target', mode: 'ai', source: { id: 'saved-ai', revision: 2 }, expected: displayed.chunks,
    });
    expect(result.current.editingChunk).toBeNull();
  });

  it('replaces a stale comparison after a second conflict and retires old decisions and editor sessions', async () => {
    const opening = twoChunkSource('saved-ai', 1, 'Target text', 'Opening sibling');
    const firstLatest = twoChunkSource('saved-ai', 2, 'Target text', 'First remote sibling');
    const secondLatest = twoChunkSource('saved-ai', 3, 'Target text', 'Second remote sibling');
    const props = options({ sermon: { audioSources: { ai: opening }, audioMetadata: { mode: 'ai' } } as unknown as Sermon });
    (apiClient as jest.Mock).mockResolvedValueOnce(conflictReply('ai', { ai: firstLatest }))
      .mockResolvedValueOnce(conflictReply('ai', { ai: secondLatest }));
    const { result } = renderHook(() => usePreparedSpeech(props));
    act(() => result.current.openChunk(result.current.chunks[0]));
    let first!: Promise<void>;
    act(() => { first = result.current.saveChunk(0, 'First candidate').catch(() => undefined); });
    await act(async () => { await first; });
    const oldDecision = result.current.editingConflict!;
    expect(oldDecision.source).toEqual(firstLatest);

    let second!: Promise<void>;
    act(() => { second = result.current.resolveChunk(oldDecision, 0, 'Candidate after first conflict').catch(() => undefined); });
    await act(async () => { await second; });
    const newDecision = result.current.editingConflict!;
    expect(newDecision).not.toBe(oldDecision);
    expect(newDecision.source).toEqual(secondLatest);
    await expect(result.current.resolveChunk(oldDecision, 0, 'Stale candidate')).rejects.toThrow('audioExport.chunksChangedElsewhere');
    expect(apiClient).toHaveBeenCalledTimes(2);

    act(() => { result.current.closeChunk(); result.current.openChunk(result.current.chunks[0]); });
    await expect(result.current.resolveChunk(newDecision, 0, 'Candidate from closed editor')).rejects.toThrow('audioExport.chunksChangedElsewhere');
    expect(apiClient).toHaveBeenCalledTimes(2);
    expect(result.current.editingConflict).toBeUndefined();
  });

  it('keeps an explicitly missing AI source absent despite cached words and refuses writes from its conflict', async () => {
    const cached = makeSource('cached-ai', 'Cached AI words');
    const props = options({ sermon: { audioSources: { ai: cached }, audioMetadata: { mode: 'ai' } } as unknown as Sermon });
    (apiClient as jest.Mock).mockResolvedValueOnce(conflictReply('ai', { raw: makeSource('raw', 'Raw words') }, []));
    const { result } = renderHook(() => usePreparedSpeech(props));
    act(() => result.current.openChunk(result.current.chunks[0]));
    let attempt!: Promise<void>;
    act(() => { attempt = result.current.saveChunk(0, 'Candidate text').catch(() => undefined); });
    await act(async () => { await attempt; });

    const decision = result.current.editingConflict!;
    expect(result.current.sources.ai).toEqual(cached);
    expect(decision.source).toBeUndefined();
    expect(result.current.useStoredChunk(decision, 0)).toBeNull();
    await expect(result.current.resolveChunk(decision, 0, 'Must not write')).rejects.toThrow('audioExport.chunksChangedElsewhere');
    expect(apiClient).toHaveBeenCalledTimes(1);
  });

  it('does not send a correction after its editor closes while authentication headers are pending', async () => {
    const headers = deferred();
    const props = options();
    jest.mocked(getAuthenticatedRequestHeaders).mockReturnValueOnce(headers.promise as Promise<Record<string, string>>);
    const { result } = renderHook(() => usePreparedSpeech(props));
    act(() => result.current.openChunk(result.current.chunks[0]));
    let save!: Promise<void>;
    act(() => { save = result.current.saveChunk(0, 'Draft while auth waits').catch(() => undefined); });
    await waitFor(() => expect(getAuthenticatedRequestHeaders).toHaveBeenCalledTimes(1));
    act(() => result.current.closeChunk());
    await act(async () => { headers.resolve({ Authorization: 'Bearer test' }); await save; });

    expect(apiClient).not.toHaveBeenCalled();
  });

  it('reconciles a retired conflict without attaching it to a newer editor', async () => {
    const pending = deferred();
    const original = makeSource('saved-ai', 'Opening words', 1);
    const latest = makeSource('saved-ai', 'Remote latest words', 2);
    (apiClient as jest.Mock).mockReturnValue(pending.promise);
    const props = options({ sermon: { audioSources: { ai: original }, audioMetadata: { mode: 'ai' } } as unknown as Sermon });
    const { result } = renderHook(() => usePreparedSpeech(props));
    act(() => result.current.openChunk(result.current.chunks[0]));
    let oldSave!: Promise<void>;
    act(() => { oldSave = result.current.saveChunk(0, 'Old editor candidate').catch(() => undefined); });
    await waitFor(() => expect(apiClient).toHaveBeenCalledTimes(1));
    act(() => { result.current.closeChunk(); result.current.openChunk(result.current.chunks[0]); });
    const newSession = result.current.editingSession;

    await act(async () => {
      pending.resolve(conflictReply('ai', { ai: latest }));
      await oldSave;
    });

    expect(result.current.source).toEqual(latest);
    expect(result.current.editingSession).toBe(newSession);
    expect(result.current.editingConflict).toBeUndefined();
  });

  it('uses stored conflict words as the next correction baseline', async () => {
    const opening = makeSource('saved-ai', 'Opening text', 1);
    const displayed = makeSource('saved-ai', 'Stored current text', 2);
    const accepted = makeSource('saved-ai', 'Correction after stored choice', 3);
    (apiClient as jest.Mock).mockResolvedValueOnce(conflictReply('ai', { ai: displayed })).mockResolvedValueOnce(reply({ ai: accepted }));
    const props = options({ sermon: { audioSources: { ai: opening }, audioMetadata: { mode: 'ai' } } as unknown as Sermon });
    const { result } = renderHook(() => usePreparedSpeech(props));
    act(() => result.current.openChunk(result.current.chunks[0]));
    let attempt!: Promise<void>;
    act(() => { attempt = result.current.saveChunk(0, 'Candidate text').catch(() => undefined); });
    await act(async () => { await attempt; });
    const decision = result.current.editingConflict!;

    let stored!: ReturnType<typeof result.current.useStoredChunk>;
    act(() => { stored = result.current.useStoredChunk(decision, 0); });
    expect(stored?.text).toBe('Stored current text');
    expect(result.current.editingChunk?.text).toBe('Stored current text');
    expect(result.current.editingConflict).toBeUndefined();
    await act(async () => { await result.current.saveChunk(0, 'Correction after stored choice'); });

    const [, request] = (apiClient as jest.Mock).mock.calls[1];
    expect(JSON.parse(request.body)).toEqual({
      text: 'Correction after stored choice', mode: 'ai', source: { id: 'saved-ai', revision: 2 }, expected: displayed.chunks,
    });
  });

  it('keeps the explicitly chosen regenerated target across a second conflict on that source', async () => {
    const opening = makeSource('old-source', 'Original fragment', 1);
    const regenerated = twoChunkSource('regenerated-source', 2, 'First new fragment', 'Chosen second fragment');
    const regeneratedAgain = twoChunkSource('regenerated-source', 3, 'First new fragment', 'Chosen second fragment');
    const props = options({ sermon: { audioSources: { ai: opening }, audioMetadata: { mode: 'ai' } } as unknown as Sermon });
    (apiClient as jest.Mock).mockResolvedValueOnce(conflictReply('ai', { ai: regenerated }))
      .mockResolvedValueOnce(conflictReply('ai', { ai: regeneratedAgain }));
    const { result } = renderHook(() => usePreparedSpeech(props));
    act(() => result.current.openChunk(result.current.chunks[0]));
    let first!: Promise<void>;
    act(() => { first = result.current.saveChunk(0, 'My candidate').catch(() => undefined); });
    await act(async () => { await first; });
    const firstDecision = result.current.editingConflict!;
    expect(firstDecision.targetIndex).toBeNull();

    let retry!: Promise<void>;
    act(() => { retry = result.current.resolveChunk(firstDecision, 1, 'My candidate on chosen fragment').catch(() => undefined); });
    await act(async () => { await retry; });

    expect(result.current.editingConflict?.source).toEqual(regeneratedAgain);
    expect(result.current.editingConflict?.targetIndex).toBe(1);
  });

});
