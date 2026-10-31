'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { saidError, type FailureWords } from '@/utils/actionFailureMessage';
import { CHUNKS_CHANGED, storedSource } from '@/utils/audioChunkIdentity';
import { getAuthenticatedRequestHeaders } from '@/utils/authenticatedRequest';
import { newClientId } from '@/utils/clientId';
import { mergePreparedAudioSources, preparedAudioCovers, preparedAudioVersion, preparedAudioTargetUnchanged, readPreparedAudioSources } from '@/utils/preparedAudioSources';

import type { Sermon } from '@/models/models';
import type { AudioChunk, AudioSourceMode, PreparedAudioSet, PreparedAudioSources, SermonSection, TTSProvider } from '@/types/audioGeneration.types';

export type SpeechPreview = AudioChunk & { preview: string };
interface SourceState { identity: string; sources: PreparedAudioSources; choice: AudioSourceMode }
export interface SpeechCorrectionConflict { id: string; source: PreparedAudioSet | undefined; targetIndex: number | null }
interface Editor { identity: string; session: string; mode: AudioSourceMode; source: PreparedAudioSet; chunk: SpeechPreview; conflict?: SpeechCorrectionConflict }
interface Options {
  owner: string | null; sermonId: string; sermon: Sermon | null; provider: TTSProvider; sections: SermonSection[];
  setSections: (value: SermonSection[]) => void; setError: (value: FailureWords | null) => void;
  aiBlocked: boolean; refreshUsage: () => Promise<unknown>;
  requestPreparation: (body: Record<string, unknown>, headers: Record<string, string>) => Promise<Response>;
  requestCorrection: (index: number, body: Record<string, unknown>, headers: Record<string, string>) => Promise<Response>;
}
const CHANGED = 'audioExport.chunksChangedElsewhere';
const EMPTY_SOURCES: PreparedAudioSources = {};
const preview = (chunks: AudioChunk[]): SpeechPreview[] => chunks.map(chunk => ({ ...chunk, preview: chunk.text }));
const isSourceConflict = (response: Response, data: { code?: unknown }) => response.status === 409 && data.code === CHUNKS_CHANGED;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** A response without revisions can only update the still-current legacy request. */
function acceptLegacyPreparation(previous: SourceState, key: string, mode: AudioSourceMode, value: PreparedAudioSet, active: boolean): SourceState {
  if (previous.identity !== key || !active || (previous.sources[mode]?.revision ?? 0) !== 0) return previous;
  return { ...previous, sources: { ...previous.sources, [mode]: value } };
}

async function requestPreparation(
  options: Options, mode: AudioSourceMode, sections: SermonSection[], opening: PreparedAudioSet | undefined,
  isCurrent: () => boolean,
) {
  const headers = await getAuthenticatedRequestHeaders(options.owner);
  if (!isCurrent()) return undefined;
  const response = await options.requestPreparation({
    sections, provider: options.provider, saveToDb: true, useRawText: mode === 'raw',
    ...(opening ? { source: preparedAudioVersion(opening) } : {}),
  }, headers);
  const data = await response.json();
  return isCurrent() ? { response, data } : undefined;
}

/** Sources are durable authored data; selections, waits and editor sessions are separate UI state. */
export function usePreparedSpeech(options: Options) {
  const { owner, sermonId, sermon, provider, setSections } = options;
  const identity = JSON.stringify([owner, sermonId]);
  const [state, setState] = useState<SourceState>({ identity, sources: {}, choice: 'ai' });
  const [wait, setWait] = useState<{ identity: string; token: number } | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const sequence = useRef(0), seeded = useRef<string | null>(null);
  const latest = useRef({ identity, options, editor, disposed: false });
  latest.current = { identity, options, editor, disposed: latest.current.disposed };
  useEffect(() => { latest.current.disposed = false; return () => { latest.current.disposed = true; }; }, []);
  const current = useCallback((key: string) => !latest.current.disposed && latest.current.identity === key, []);
  const sources = state.identity === identity ? state.sources : EMPTY_SOURCES;
  const mode: AudioSourceMode = options.provider === 'google' ? 'raw' : state.identity === identity ? state.choice : 'ai';
  const source = sources[mode];
  const chunks = useMemo(() => preview(source?.chunks ?? []), [source]);

  const reconcile = useCallback((payload: unknown) => {
    if (!object(payload)) return;
    const key = identity; if (!current(key)) return;
    const incoming = readPreparedAudioSources({ audioSources: payload.sources, audioChunks: payload.chunks, audioMetadata: { mode: payload.mode } });
    setState(previous => current(key) ? { identity: key, choice: previous.identity === key ? previous.choice : 'ai',
      sources: mergePreparedAudioSources(previous.identity === key ? previous.sources : {}, incoming) } : previous);
  }, [identity, current]);

  useEffect(() => {
    if (!owner || !sermon) return;
    const incoming = readPreparedAudioSources(sermon), first = seeded.current !== identity;
    if (first) {
      seeded.current = identity;
      const selected = provider === 'google' ? 'raw' : storedSource(sermon);
      const initial = incoming[selected] ?? incoming.ai ?? incoming.raw;
      if (initial?.sections.length) setSections(initial.sections);
    }
    setState(previous => ({ identity, choice: first ? storedSource(sermon) : previous.identity === identity ? previous.choice : 'ai',
      sources: mergePreparedAudioSources(previous.identity === identity ? previous.sources : {}, incoming) }));
  }, [identity, owner, sermon, provider, setSections]);

  const choose = useCallback((choice: AudioSourceMode) => {
    const key = latest.current.identity;
    setState(previous => ({ identity: key, choice, sources: previous.identity === key ? previous.sources : {} }));
  }, []);

  const prepareSource = useCallback(async (targetMode: AudioSourceMode) => {
    const key = identity, now = latest.current.options;
    if (!current(key) || !now.owner || (targetMode === 'ai' && now.aiBlocked)) return;
    const token = ++sequence.current, selected = [...now.sections], opening = sources[targetMode];
    setWait({ identity: key, token }); now.setError(null);
    try {
      const settled = await requestPreparation(now, targetMode, selected, opening, () => current(key));
      if (!settled) return;
      const { response, data } = settled;
      if (!response.ok) {
        if (isSourceConflict(response, data)) { reconcile(data); if (sequence.current === token) now.setError({ key: CHANGED }); return; }
        throw new Error(data.error || 'Optimization failed');
      }
      if (object(data.sources)) reconcile(data);
      else if (Array.isArray(data.chunks)) {
        // Old server responses carry no version. Keep their words, never invent server revision proof.
        const value: PreparedAudioSet = { id: 'legacy-' + targetMode, revision: 0, sections: selected, chunks: data.chunks };
        setState(previous => acceptLegacyPreparation(previous, key, targetMode, value, sequence.current === token));
      }
      if (targetMode === 'ai') void now.refreshUsage().catch(error => console.warn('Audio usage refresh failed', error));
    } catch (error) {
      if (current(key) && sequence.current === token) now.setError({ said: error instanceof Error ? error.message : 'Optimization failed' });
    } finally {
      if (current(key)) setWait(previous => previous?.identity === key && previous.token === token ? null : previous);
    }
  }, [identity, current, sources, reconcile]);

  const selectSource = useCallback(async (targetMode: AudioSourceMode) => {
    if (!current(identity)) return;
    choose(targetMode); latest.current.options.setError(null);
    // The first request for Original can prepare it; an existing saved set is never rebuilt by navigation.
    if (targetMode === 'raw' && !sources.raw) await prepareSource('raw');
  }, [identity, current, choose, sources, prepareSource]);

  const openChunk = useCallback((chunk: SpeechPreview) => {
    if (!current(identity) || !source) return;
    setEditor({ identity, session: newClientId(), mode, source: JSON.parse(JSON.stringify(source)) as PreparedAudioSet, chunk });
  }, [identity, current, mode, source]);
  const closeChunk = useCallback(() => { latest.current.editor = null; setEditor(null); }, []);


  const saveCorrection = useCallback(async (index: number, text: string, decision?: SpeechCorrectionConflict) => {
    const captured = latest.current.editor, key = identity;
    if (!captured || captured.identity !== key || !current(key)
      || (decision && captured.conflict !== decision)) throw saidError(CHANGED);
    const opening = decision ? decision.source : captured.source;
    if (!opening || !Number.isSafeInteger(index) || index < 0 || index >= opening.chunks.length) throw saidError(CHANGED);
    const headers = await getAuthenticatedRequestHeaders(owner);
    if (!current(key) || latest.current.editor?.session !== captured.session
      || (decision && latest.current.editor.conflict !== decision)) throw saidError(CHANGED);
    const response = await latest.current.options.requestCorrection(index, {
      text, mode: captured.mode, source: preparedAudioVersion(opening), expected: opening.chunks,
    }, headers);
    const data = await response.json(); if (!current(key)) throw saidError(CHANGED);
    if (!response.ok) {
      if (isSourceConflict(response, data)) {
        reconcile(data);
        // Explicit absence in a refusal is meaningful; monotonic cache merging cannot supply this candidate.
        const incoming = readPreparedAudioSources({ audioSources: data.sources, audioChunks: data.chunks, audioMetadata: { mode: data.mode } });
        const source = incoming[captured.mode];
        const conflict: SpeechCorrectionConflict = {
          id: newClientId(), source,
          targetIndex: preparedAudioTargetUnchanged(opening, source, index) ? index : null,
        };
        setEditor(previous => previous?.identity === key && previous.session === captured.session ? { ...previous, conflict } : previous);
        throw saidError(CHANGED);
      }
      throw new Error(data.error || 'Save failed');
    }
    if (object(data.sources)) reconcile(data);
    else {
      const corrected = { ...opening, chunks: opening.chunks.map((chunk, position) => position === index ? { ...chunk, text } : chunk) };
      setState(previous => {
        const held = previous.sources[captured.mode];
        if (previous.identity !== key || !held || held.id !== opening.id || held.revision !== opening.revision) return previous;
        return { ...previous, sources: { ...previous.sources, [captured.mode]: corrected } };
      });
    }
    setEditor(previous => previous?.identity === key && previous.session === captured.session ? null : previous);
  }, [identity, owner, current, reconcile]);

  const saveChunk = useCallback((index: number, text: string) => saveCorrection(index, text), [saveCorrection]);
  const resolveChunk = useCallback((decision: SpeechCorrectionConflict, index: number, text: string) =>
    saveCorrection(index, text, decision), [saveCorrection]);
  const useStoredChunk = useCallback((decision: SpeechCorrectionConflict, index: number): SpeechPreview | null => {
    const captured = latest.current.editor;
    const source = decision.source;
    if (!captured || !current(identity) || captured.identity !== identity || captured.conflict !== decision
      || !source || !Number.isSafeInteger(index) || index < 0 || index >= source.chunks.length) return null;
    const chunk = { ...source.chunks[index], preview: source.chunks[index].text };
    setEditor(previous => previous?.identity === identity && previous.session === captured.session && previous.conflict === decision
      ? { ...previous, source, chunk, conflict: undefined } : previous);
    return chunk;
  }, [identity, current]);

  return { mode, chunks, source, sources, isLoading: wait?.identity === identity,
    hasCoverage: preparedAudioCovers(source, options.sections),
    ready: preparedAudioCovers(source, options.sections) && chunks.some(chunk => options.sections.includes(chunk.sectionId)),
    selectSource, prepareSource, reconcile, openChunk, closeChunk, saveChunk, resolveChunk, useStoredChunk,
    editingChunk: editor?.identity === identity ? editor.chunk : null,
    editingSession: editor?.identity === identity ? editor.session : undefined,
    editingConflict: editor?.identity === identity ? editor.conflict : undefined,
    generationSource: source ? preparedAudioVersion(source) : undefined,
  };
}
