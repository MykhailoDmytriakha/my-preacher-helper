import type { AnalysisMode } from './AnalysisParts';

/*
 * THE OPEN ANALYSIS IN THE PAGE'S ADDRESS (the owner, 30.10: «при обновлении не выкидывало в текст Библии»): the reader's
 * address gains `analysis=<note id>` and `mode=edit|view` while an analysis is open, so a reload opens it again, in the
 * same mode. Written with the History API in place, as the reader keeps its own address (`(pages)/(private)/bible/page.tsx`):
 * no new history entry, Next's own fields in `history.state` kept.
 */
const ID = 'analysis';
const MODE = 'mode';

export type AnalysisAddress = { id: string; mode: AnalysisMode };

/** The analysis the address names, if any. */
export function readAnalysisAddress(): AnalysisAddress | null {
  if (typeof window === 'undefined') return null;
  const query = new URLSearchParams(window.location.search);
  const id = query.get(ID);
  if (!id) return null;
  return { id, mode: query.get(MODE) === 'view' ? 'view' : 'edit' };
}

/** The address names this analysis in this mode, or — `null` — no analysis. */
export function writeAnalysisAddress(value: AnalysisAddress | null): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (value) {
    url.searchParams.set(ID, value.id);
    url.searchParams.set(MODE, value.mode);
  } else {
    url.searchParams.delete(ID);
    url.searchParams.delete(MODE);
  }
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, '', next);
}
