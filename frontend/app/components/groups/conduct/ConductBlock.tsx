'use client';

import { Bars3Icon, PauseIcon, PlayIcon } from '@heroicons/react/24/outline';
import { ChevronDownIcon } from '@heroicons/react/24/solid';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ScriptureLinks, ScriptureText } from '@/components/bible/ScriptureLinks';
import { VerseSheet, type SheetReference } from '@/components/bible/VerseSheet';
import FloatingTextScaleControls from '@/components/FloatingTextScaleControls';
import MarkdownDisplay from '@/components/MarkdownDisplay';
import { Chip } from '@/components/ui/Chip';
import { formatTime, useConductTimer } from '@/hooks/useConductTimer';
import { GroupBlockTemplate, GroupFlowItem } from '@/models/models';
import { resolveAppLocale, type AppLocale } from '@/utils/appLocale';
import { namesAPlace, referenceFromText } from '@/utils/bibleLink';
import { referenceBibleFor, sameScriptureReference } from '@/utils/scriptureReferenceNumbering';

type BlockReference = { key: string; label: string; reference: SheetReference | null };

/**
 * The passages kept with a block, each place once, typed in the Bible of the interface's language.
 * A kept reference that names no place to open ("see the handout", "Рим 25") stays a label. The
 * references a leader writes into the text are links where they stand (`ScriptureLinks`).
 */
function blockReferences(kept: string[], locale: AppLocale): BlockReference[] {
  const found: BlockReference[] = [];
  const add = (label: string, reference: SheetReference | null) => {
    const same = reference
      ? found.some((each) => each.reference && sameScriptureReference(each.reference, reference))
      : found.some((each) => !each.reference && each.label === label);
    if (!same) found.push({ key: `${found.length}|${label}`, label, reference: reference ? { ...reference, label } : null });
  };
  kept.forEach((raw) => {
    const reference = referenceFromText(raw, referenceBibleFor(locale));
    add(raw, reference && namesAPlace(reference) ? reference : null);
  });
  return found;
}

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
  const { t, i18n } = useTranslation();
  const [notesOpen, setNotesOpen] = useState(false);
  // A reference of the block opens over the meeting: the block, its timer and the meeting's clock
  // stay as they are. The bar above and the timer below stay in sight.
  const [verse, setVerse] = useState<SheetReference | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<HTMLDivElement | null>(null);
  const keepVisible = useMemo(() => ({ top: headerRef, bottom: timerRef }), []);
  const locale = resolveAppLocale(i18n?.language);
  const title = flowItem.instanceTitle || template.title;
  const references = useMemo(
    () => blockReferences(template.scriptureRefs ?? [], locale),
    [template.scriptureRefs, locale]
  );

  const hasDuration = !!(flowItem.durationMin && flowItem.durationMin > 0);

  // Starts from initialElapsed so timer accumulates correctly across overview peeks
  const { elapsed, timeLeft, isOvertime, isWarning } = useConductTimer(
    flowItem.durationMin,
    isPaused,
    initialElapsed
  );

  const isLastBlock = index === total - 1;
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

  // A reference anywhere in the block — its text, a question, a note — opens over the meeting.
  return (
    <ScriptureLinks onOpen={setVerse}>
    <div className="flex h-full flex-col">
      {/* Header */}
      <div ref={headerRef} className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
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

      {/*
        Block content — the part a leader reads aloud, and the only part the text size control
        grows. It is the council's meeting screen rule (`.meeting-scaled` in globals.css): the
        scale is applied once, to this container, and every line states its size as a share of
        it, so the title stays a title at 200%. The header, the timer and the buttons keep their
        size, as on the council.
      */}
      {/* The bottom inset lets the last line scroll clear of the floating text size button. */}
      <div className="flex-1 overflow-y-auto px-5 pb-20 pt-6">
        <div className="meeting-scaled">
          <h1 className="mb-[0.5em] break-words text-[1.9em] font-bold text-gray-900 dark:text-gray-100"><ScriptureText text={title} /></h1>

          {template.content && (
            // Written in the rich Markdown editor, so it is Markdown: shown raw, ** and ## reached the screen.
            <div className="text-gray-800 dark:text-gray-200">
              <MarkdownDisplay content={template.content} />
            </div>
          )}

          {references.length > 0 && (
            <div className="mt-[1em] flex flex-wrap gap-2">
              {references.map(({ key, label, reference }) => (
                // `anywhere`, not `break-words`: inside the chip's flex label only it lets a long reference wrap.
                // A reference the app reads opens its text over the meeting; one it does not stays a label.
                <Chip
                  key={key}
                  tone="blue"
                  size="lg"
                  className="max-w-full [overflow-wrap:anywhere]"
                  onClick={reference ? () => setVerse(reference) : undefined}
                >
                  {label}
                </Chip>
              ))}
            </div>
          )}

          {template.questions && template.questions.length > 0 && (
            <ul className="mt-[1em] space-y-[0.5em]">
              {template.questions.map((q, i) => (
                <li key={i} className="flex gap-[0.5em] text-[0.875em] text-gray-700 dark:text-gray-300">
                  <span className="font-semibold text-gray-400">{i + 1}.</span>
                  <span className="min-w-0 break-words"><ScriptureText text={q} /></span>
                </li>
              ))}
            </ul>
          )}
        </div>
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
            // Plain text from a text area, not Markdown: kept as typed, and as large as the body.
            // Capped and scrolled on its own, so long notes at 200% cannot squeeze the block away.
            <div className="meeting-scaled max-h-[40vh] overflow-y-auto border-t border-gray-100 bg-amber-50/60 px-5 py-4 dark:border-gray-700 dark:bg-amber-950/20">
              <p className="whitespace-pre-wrap break-words text-[0.875em] text-gray-700 dark:text-gray-300"><ScriptureText text={flowItem.instanceNotes ?? ''} /></p>
            </div>
          )}
        </div>
      )}

      {/* Block timer — always visible */}
      <div ref={timerRef} className="border-t border-gray-200 px-5 py-3 text-center dark:border-gray-700">
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

      {/*
        THE SAME ROUND CONTROL AS IN THE NOTES AND ON THE COUNCIL — one provider, one remembered
        size. Lifted clear of the timer and the navigation bar, so it never sits on "Next", and
        above this screen's own layer (z-[200] on the conduct page).
      */}
      <FloatingTextScaleControls className="!bottom-44 !right-6 z-[210]" />

      <VerseSheet reference={verse} onClose={() => setVerse(null)} keepVisible={keepVisible} />
    </div>
    </ScriptureLinks>
  );
}
