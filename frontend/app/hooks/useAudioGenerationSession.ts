'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { newClientId } from '@/utils/clientId';

export interface AudioGenerationProgress {
  key: string; exportId: string; parts: Uint8Array[]; nextOffset: number; total?: number; filename?: string; mimeType?: string;
}
export interface AudioGenerationRun {
  scope: string; controller: AbortController; progress: AudioGenerationProgress; checkpoint: () => void;
}
interface UiProgress { current: number; total: number; percent?: number; status?: string }
interface AudioFile { url: string; filename: string }
interface UiState { scope: string; run: AudioGenerationRun | null; view: 'working' | 'generating' | 'success'; progress: UiProgress; file: AudioFile | null }
const initial = (scope: string): UiState => ({ scope, run: null, view: 'working', progress: { current: 0, total: 0, percent: 0 }, file: null });
const canceled = () => Object.assign(new Error('Audio generation was canceled'), { name: 'AbortError' });

/** A run, its completed batches and its visible result belong to one owner/sermon/window. */
export function useAudioGenerationSession(owner: string | null, sermonId: string) {
  const scope = JSON.stringify([owner, sermonId]);
  const latest = useRef(scope), mounted = useRef(false);
  latest.current = scope;
  const active = useRef<AudioGenerationRun | null>(null);
  const cache = useRef<{ scope: string; progress: AudioGenerationProgress } | null>(null);
  const [state, setState] = useState<UiState>(() => initial(scope));
  const visible = state.scope === scope ? state : initial(scope);

  const isCurrent = useCallback((run: AudioGenerationRun) =>
    mounted.current && latest.current === run.scope && active.current === run, []);
  const isLive = useCallback((run: AudioGenerationRun) => isCurrent(run) && !run.controller.signal.aborted, [isCurrent]);
  const retire = useCallback((forScope: string) => {
    if (active.current?.scope === forScope) { active.current.controller.abort(); active.current = null; }
    if (cache.current?.scope === forScope) cache.current = null;
  }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; retire(latest.current); }; }, [retire]);
  useEffect(() => () => retire(scope), [scope, retire]);

  const begin = useCallback((body: Record<string, unknown>, total: number): AudioGenerationRun | null => {
    if (!owner || !mounted.current || latest.current !== scope) return null;
    active.current?.controller.abort();
    const key = JSON.stringify([scope, body]);
    const progress = cache.current?.scope === scope && cache.current.progress.key === key
      ? cache.current.progress : { key, exportId: newClientId(), parts: [], nextOffset: 0 };
    cache.current = { scope, progress };
    const run: AudioGenerationRun = { scope, controller: new AbortController(), progress, checkpoint: () => undefined };
    run.checkpoint = () => { if (!isLive(run)) throw canceled(); };
    active.current = run;
    setState({ ...initial(scope), run, view: 'generating', progress: { current: 0, total, percent: 0 } });
    return run;
  }, [owner, scope, isLive]);

  const report = useCallback((run: AudioGenerationRun, progress: UiProgress) => {
    if (isLive(run)) setState(previous => previous.scope === run.scope && previous.run === run ? { ...previous, progress } : previous);
  }, [isLive]);
  const complete = useCallback((run: AudioGenerationRun, file: AudioFile) => {
    if (!isLive(run)) return false;
    cache.current = null;
    setState(previous => previous.scope === run.scope && previous.run === run
      ? { ...previous, view: 'success', file, progress: { ...previous.progress, percent: 100 } } : previous);
    return true;
  }, [isLive]);
  const fail = useCallback((run: AudioGenerationRun) => {
    if (isCurrent(run)) setState(previous => previous.scope === run.scope && previous.run === run ? { ...previous, view: 'working' } : previous);
  }, [isCurrent]);
  const finish = useCallback((run: AudioGenerationRun) => {
    if (isCurrent(run)) active.current = null;
  }, [isCurrent]);
  const cancel = useCallback(() => {
    const run = active.current;
    if (!run || !isCurrent(run)) return false;
    run.controller.abort(); active.current = null;
    setState(previous => previous.scope === run.scope && previous.run === run ? { ...previous, view: 'working' } : previous);
    return true;
  }, [isCurrent]);

  const reset = useCallback(() => { retire(scope); setState(initial(scope)); }, [retire, scope]);

  const canResume = useCallback((body: Record<string, unknown>) => cache.current?.scope === scope &&
    cache.current.progress.key === JSON.stringify([scope, body]), [scope]);

  return { reset, canResume, scope, view: visible.view, genProgress: visible.progress, generatedFile: visible.file,
    begin, report, complete, fail, finish, cancel, isCurrent };
}
