'use client';

import { ChevronRightIcon } from '@heroicons/react/20/solid';
import { useRef, type MouseEvent } from 'react';

import { AnalysisPreview } from './AnalysisPreview';

import type { StudyAnalysis } from '@/models/models';

/**
 * An analysis in the list is its structure (the owner, 2026-10-29: «справа должна показываться как раз структура —
 * небольшим текстом, но красиво»): a part a line, each step deeper, by the violet bar the reader draws beside it. All of
 * it, scrolling in its own box so the window does not grow: read here and go on («ты можешь не переходить внутрь, но
 * посмотреть и пойти дальше»). A press on it opens the analysis (the owner, 30.10: «вся эта секция… будет кликабельная.
 * Нажал и перешёл»). A scroll is not a press — a finger's swipe fires no click — and neither is the end of a text
 * selection or a grab of the box's scrollbar. The same box is a sermon's block diagram in prep step 3 (`BlockDiagramSection`).
 */
export function AnalysisOutline({ text, analysis, label, onOpen, grow = false }: { text: string; analysis?: StudyAnalysis; label: string; onOpen: () => void;
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
        <AnalysisPreview text={text} analysis={analysis} />
      </div>
      <ChevronRightIcon className="mt-1 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
    </div>
  );
}
