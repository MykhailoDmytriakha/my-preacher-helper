'use client';

import { ChevronRightIcon } from '@heroicons/react/20/solid';
import { useLayoutEffect, useRef, useState, type MouseEvent } from 'react';

import { analysisOutline } from '@/utils/passageAnalysis';

import { AnalysisPreview } from './AnalysisPreview';

import type { StudyAnalysis } from '@/models/models';

/** How many of its lines a folded card shows before the rest fades: the opening of the structure, not all of it. */
const GLIMPSE_LINES = 3;

/**
 * An analysis in the list is its structure (the owner, 2026-10-29: «справа должна показываться как раз структура —
 * небольшим текстом, но красиво»): a part a line, each step deeper, by the violet bar the reader draws beside it. All of
 * it, scrolling in its own box so the window does not grow: read here and go on («ты можешь не переходить внутрь, но
 * посмотреть и пойти дальше»). A press on it opens the analysis (the owner, 30.10: «вся эта секция… будет кликабельная.
 * Нажал и перешёл»). A scroll is not a press — a finger's swipe fires no click — and neither is the end of a text
 * selection or a grab of the box's scrollbar. The same box is a sermon's block diagram in prep step 3 (`BlockDiagramSection`)
 * and an analysis's card opened in Studies' list (`StudyNoteCard`).
 */
export function AnalysisOutline({ text, analysis, label, onOpen, grow = false, searchQuery }: { text: string; analysis?: StudyAnalysis; label: string; onOpen: () => void;
  /** Words a search over the list found, lit. */
  searchQuery?: string;
  /**
   * The box keeps no height of its own: alone in its window, the window grows to the screen's gaps and scrolls it; as a
   * sermon's block diagram, the page shows it whole (the owner, 31.10: «без скроллинга… видна полностью»).
   */
  grow?: boolean }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const press = (event: MouseEvent<HTMLDivElement>) => {
    const box = boxRef.current;
    if (window.getSelection()?.toString()) return;
    if (box && event.target === box && event.nativeEvent.offsetX >= box.clientWidth) return;
    onOpen();
  };
  return (
    <div role="button" tabIndex={0} aria-label={label} onClick={press}
      onKeyDown={(event) => {
        if ((event.key !== 'Enter' && event.key !== ' ') || event.target !== event.currentTarget) return;
        event.preventDefault();
        onOpen();
      }}
      className="-mx-2 mb-2 flex cursor-pointer items-start gap-1 rounded-xl px-2 py-2 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 active:bg-gray-100 dark:hover:bg-gray-800 dark:active:bg-gray-700">
      {/* From the window's left edge (the owner, 30.10: «ближе к левому краю»): the room the structure and its ties' arrows need. */}
      <div ref={boxRef} data-testid="analysis-outline"
        className={`min-w-0 flex-1 ${grow ? '' : 'max-h-[min(22rem,45vh)] overflow-y-auto overscroll-contain '}border-l-2 border-violet-200 pr-2 font-serif text-[14px] leading-snug dark:border-violet-800`}>
        <AnalysisPreview text={text} analysis={analysis} searchQuery={searchQuery} />
      </div>
      <ChevronRightIcon className="mt-1 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
    </div>
  );
}

/**
 * The opening of an analysis on a folded card in Studies' list (the owner, 03.11: «ты должен видеть … то, как ты видишь это
 * в просмотре… а не так, как пункты-подпункты»): its first lines drawn as the structure is everywhere — a part a line,
 * stepped, by the violet bar — and the rest fading out. A short one is shown whole, with no fade over its last line. The
 * height is bounded always: a part is a line of the structure, but a long one wraps into many on a phone (Codex, 04.11),
 * so the fade comes where the words go on past the bound, measured as drawn.
 */
export function AnalysisGlimpse({ text, analysis }: { text: string; analysis?: StudyAnalysis }) {
  const more = analysisOutline(text).length > GLIMPSE_LINES;
  const box = useRef<HTMLDivElement>(null);
  const [spills, setSpills] = useState(false);
  useLayoutEffect(() => {
    const drawn = box.current;
    if (!drawn) return undefined;
    const measure = () => setSpills(drawn.scrollHeight > drawn.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const watch = new ResizeObserver(measure);
    watch.observe(drawn);
    return () => watch.disconnect();
  }, [text, analysis]);
  return (
    <div ref={box} data-testid="analysis-glimpse"
      className={`max-h-[4.75rem] overflow-hidden border-l-2 border-violet-200 font-serif text-[14px] leading-snug dark:border-violet-800 ${more || spills ? '[mask-image:linear-gradient(to_bottom,black_55%,transparent)]' : ''}`}>
      <AnalysisPreview text={text} analysis={analysis} />
    </div>
  );
}
