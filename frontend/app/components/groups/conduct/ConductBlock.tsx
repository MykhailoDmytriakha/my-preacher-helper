'use client';

import { Bars3Icon, PauseIcon, PlayIcon } from '@heroicons/react/24/outline';
import { ChevronDownIcon } from '@heroicons/react/24/solid';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatTime, useConductTimer } from '@/hooks/useConductTimer';
import { GroupBlockTemplate, GroupFlowItem } from '@/models/models';

interface ConductBlockProps {
  flowItem: GroupFlowItem;
  template: GroupBlockTemplate;
  index: number;
  total: number;
  isPaused: boolean;
  onPause: () => void;
  onResume: () => void;
  globalTimeLeft: number | null;
  globalIsOvertime: boolean;
  // Restored elapsed seconds when returning to this block after a peek
  initialElapsed: number;
  // Called with actual elapsed before any navigation
  onTimeRecorded: (flowItemId: string, elapsed: number) => void;
  onPrev: () => void;
  onNext: () => void;
  // "≡" hamburger: mid-meeting peek — timer pauses, block stays in-progress
  onPeek: () => void;
  // "Overview →" on last block: this block is done, all blocks completed
  onCompleteAll: () => void;
}

export default function ConductBlock({
  flowItem,
  template,
  index,
  total,
  isPaused,
  onPause,
  onResume,
  globalTimeLeft,
  globalIsOvertime,
  initialElapsed,
  onTimeRecorded,
  onPrev,
  onNext,
  onPeek,
  onCompleteAll,
}: ConductBlockProps) {
  const { t } = useTranslation();
  const [notesOpen, setNotesOpen] = useState(false);

  const hasDuration = !!(flowItem.durationMin && flowItem.durationMin > 0);

  // Starts from initialElapsed so timer accumulates correctly across overview peeks
  const { elapsed, timeLeft, isOvertime, isWarning } = useConductTimer(
    flowItem.durationMin,
    isPaused,
    initialElapsed
  );

  const isLastBlock = index === total - 1;
  const title = flowItem.instanceTitle || template.title;
  const hasNotes = !!(flowItem.instanceNotes && flowItem.instanceNotes.trim());

  // Record elapsed then perform navigation action
  const go = (action: () => void) => {
    onTimeRecorded(flowItem.id, elapsed);
    action();
  };

  const blockDisplayTime = hasDuration ? formatTime(timeLeft ?? 0) : formatTime(elapsed);

  const blockTimerColor = hasDuration
    ? isOvertime
      ? 'text-red-600 dark:text-red-400'
      : isWarning
        ? 'text-amber-500 dark:text-amber-400'
        : 'text-gray-800 dark:text-gray-200'
    : 'text-gray-500 dark:text-gray-400';

  const globalDisplay = globalTimeLeft !== null ? formatTime(globalTimeLeft) : null;
  const globalColor = globalIsOvertime ? 'text-red-500 dark:text-red-400' : 'text-gray-500 dark:text-gray-400';

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        {/* "≡" peek — records time and pauses */}
        <button
          onClick={() => go(onPeek)}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
        >
          <Bars3Icon className="h-4 w-4" />
          {t('conduct.block.overview', { defaultValue: 'Overview' })}
        </button>

        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
            {index + 1} / {total}
          </span>
          {globalDisplay && (
            <span className={`font-mono text-sm font-semibold tabular-nums ${globalColor}`}>
              ⏱ {globalDisplay}
            </span>
          )}
        </div>

        <button
          onClick={isPaused ? onResume : onPause}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
        >
          {isPaused ? (
            <><PlayIcon className="h-4 w-4" />{t('conduct.block.resume', { defaultValue: 'Resume' })}</>
          ) : (
            <><PauseIcon className="h-4 w-4" />{t('conduct.block.pause', { defaultValue: 'Pause' })}</>
          )}
        </button>
      </div>

      {/* Block content */}
      <div className="flex-1 overflow-y-auto px-5 py-6">
        <h1 className="mb-4 text-2xl font-bold text-gray-900 dark:text-gray-100">{title}</h1>

        {template.content && (
          <div className="prose prose-sm max-w-none whitespace-pre-wrap text-gray-800 dark:text-gray-200">
            {template.content}
          </div>
        )}

        {template.scriptureRefs && template.scriptureRefs.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {template.scriptureRefs.map((ref) => (
              <span key={ref} className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800 dark:bg-blue-900/40 dark:text-blue-200">
                {ref}
              </span>
            ))}
          </div>
        )}

        {template.questions && template.questions.length > 0 && (
          <ul className="mt-4 space-y-2">
            {template.questions.map((q, i) => (
              <li key={i} className="flex gap-2 text-sm text-gray-700 dark:text-gray-300">
                <span className="font-semibold text-gray-400">{i + 1}.</span>
                <span>{q}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Notes accordion */}
      {hasNotes && (
        <div className="border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setNotesOpen((v) => !v)}
            className="flex w-full items-center gap-2 px-5 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            <ChevronDownIcon className={`h-4 w-4 transition-transform ${notesOpen ? 'rotate-180' : ''}`} />
            {t('conduct.block.notesToggle', { defaultValue: 'Notes' })}
          </button>
          {notesOpen && (
            <div className="border-t border-gray-100 bg-amber-50/60 px-5 py-4 dark:border-gray-700 dark:bg-amber-950/20">
              <p className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">{flowItem.instanceNotes}</p>
            </div>
          )}
        </div>
      )}

      {/* Block timer — always visible */}
      <div className="border-t border-gray-200 px-5 py-3 text-center dark:border-gray-700">
        <span className={`font-mono text-3xl font-bold tabular-nums transition-colors ${blockTimerColor}`}>
          {blockDisplayTime}
        </span>
        <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
          {hasDuration
            ? isOvertime
              ? t('conduct.block.overtime', { defaultValue: 'Overtime' })
              : t('conduct.block.remaining', { defaultValue: 'Remaining' })
            : t('conduct.block.elapsed', { defaultValue: 'Elapsed' })}
        </p>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between border-t border-gray-200 px-4 py-4 dark:border-gray-700">
        <button
          onClick={() => go(onPrev)}
          disabled={index === 0}
          className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:pointer-events-none disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
        >
          ← {t('conduct.block.prev', { defaultValue: 'Back' })}
        </button>

        {isLastBlock ? (
          // "Overview →": this block is done, marks all as completed
          <button
            onClick={() => go(onCompleteAll)}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 active:scale-[0.98]"
          >
            {t('conduct.block.overview', { defaultValue: 'Overview' })} →
          </button>
        ) : (
          <button
            onClick={() => go(onNext)}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.98]"
          >
            {t('conduct.block.next', { defaultValue: 'Next' })} →
          </button>
        )}
      </div>
    </div>
  );
}
