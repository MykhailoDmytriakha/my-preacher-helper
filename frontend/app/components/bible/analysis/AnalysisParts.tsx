'use client';

import { ArrowLeftIcon, ArrowUturnLeftIcon, ChevronLeftIcon, ChevronRightIcon, PencilSquareIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';

import Switch from '@/components/ui/Switch';
import { withModifier } from '@/utils/keyboardModifier';

import type { AnalysisWord, CutLevel } from '@/utils/passageAnalysis';
import type { PointerEvent, ReactNode } from 'react';

/** How a line stands in «Просмотр»: the chosen part, the way up to it, what hangs on it, stepped back, or as it is. */
export type LineRole = 'focus' | 'path' | 'kid' | 'dim' | 'plain';
export type AnalysisMode = 'edit' | 'view';

const OUTLINE = 'border border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900';
const MARK_BREAK = 'm7.49 12-3.75 3.75m0 0 3.75 3.75m-3.75-3.75h16.5V4.499';
const MARK_UNDER = 'm16.49 12 3.75 3.75m0 0-3.75 3.75m3.75-3.75H3.74V4.499';
const MARK_GLUE = 'M11.99 7.5 8.24 3.75m0 0L4.49 7.5m3.75-3.75v16.499h11.25';
const RING: Record<LineRole, string> = {
  focus: 'bg-indigo-50 ring-2 ring-indigo-600 dark:bg-indigo-950',
  kid: 'bg-indigo-50/60 ring-1 ring-indigo-300 dark:bg-indigo-950/50',
  path: 'ring-1 ring-indigo-300',
  dim: '',
  plain: '',
};

/** The bar over the analysis: back to the text, the place and how many parts, «Правка»/«Просмотр», the marks' tools, undo, done. */
export function AnalysisHeader({ title, parts, mode, onMode, canUndo, onUndo, onClose, onEditVerses, tools, allLinks, sermons }: {
  title: string; parts: string; mode: AnalysisMode; onMode: (mode: AnalysisMode) => void; canUndo: boolean; onUndo: () => void; onClose: () => void;
  /** In «Просмотр», with links of meaning to show: the switch that draws all their arrows at once (the owner, 30.10). */
  allLinks?: { on: boolean; onToggle: () => void } | null;
  /** The reader's marker, pencil and eraser, before «Отменить». */
  tools?: ReactNode;
  /** The place pressed: the analysis's verses are chosen again in the reader. */
  onEditVerses?: () => void;
  /** By its name, the sermons made from it and a new one (`AnalysisSermons`). */
  sermons?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-gray-200 px-4 py-2.5 dark:border-gray-800 sm:px-5">
      <button type="button" onClick={onClose} className={`inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold ${OUTLINE}`}>
        <ArrowLeftIcon className="h-4 w-4" aria-hidden="true" />{t('analysis.back')}
      </button>
      {onEditVerses ? (
        <button type="button" onClick={onEditVerses} aria-label={t('analysis.editVerses')} className="group/tip relative min-w-0 rounded-lg px-1 text-left hover:bg-gray-100 dark:hover:bg-gray-900">
          <span className="flex items-center gap-1.5 truncate text-base font-bold">{title}<PencilSquareIcon className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" /></span>
          <span className="block text-xs text-gray-500 dark:text-gray-400">{parts}</span>
          <HoverLabel text={t('analysis.editVerses')} from="left" />
        </button>
      ) : (
        <div className="min-w-0">
          <div className="truncate text-base font-bold">{title}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">{parts}</div>
        </div>
      )}
      {sermons}
      <div className="mx-auto flex gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-900" role="group" aria-label={t('analysis.modes')}>
        {(['edit', 'view'] as const).map((value) => (
          <button key={value} type="button" aria-pressed={mode === value} onClick={() => onMode(value)}
            className={`h-9 rounded-lg px-4 text-sm font-semibold ${mode === value ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white' : 'text-gray-600 dark:text-gray-300'}`}>
            {t(value === 'edit' ? 'analysis.modeEdit' : 'analysis.modeView')}
          </button>
        ))}
      </div>
      {allLinks ? <Switch checked={allLinks.on} onClick={allLinks.onToggle} label={t('analysis.view.allLinks')} /> : null}
      {tools}
      <button type="button" disabled={!canUndo} onClick={onUndo} aria-keyshortcuts="Meta+Z Control+Z"
        className={`group/tip relative inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold disabled:opacity-40 ${OUTLINE}`}>
        <ArrowUturnLeftIcon className="h-4 w-4" aria-hidden="true" />{t('analysis.undo')}
        {mode === 'edit' ? <HoverLabel text={t('analysis.undoKeys', { keys: withModifier('Z') })} /> : null}
      </button>
      <button type="button" onClick={onClose} className="h-10 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700">{t('analysis.done')}</button>
    </header>
  );
}

/**
 * One word of a line: the verse number before it where a verse starts, the marks over it while it can be cut. `fill` and
 * `pencil` — the reader's marker and pencil line on it (`marks/markPaint.ts`); `ring` — the colour of a link of meaning of
 * this word that is pointed at; `linked` — it has a link of meaning, so pointing at it shows the arrow.
 */
export type LineWord = {
  index: number; word: AnalysisWord; mark: 'break' | 'glue' | null; target: 'yes' | 'no' | null; onPath: boolean; leads: boolean; last: boolean;
  fill?: string; pencil?: string; ring?: string; linked?: boolean;
};
/** The arrows left of a line: what each does, or null where there is nowhere to go. */
export type LineSteps = { up: (() => void) | null; down: (() => void) | null };

const SAME_LOOK = 'bg-indigo-600 text-white';
const UNDER_LOOK = 'bg-white text-indigo-600 ring-[1.5px] ring-inset ring-indigo-600 dark:bg-gray-900 dark:text-indigo-300 dark:ring-indigo-400';
const STEP_LOOK = 'rounded-full bg-white text-indigo-600 shadow-[inset_0_0_0_1px_#a5b4fc] dark:bg-gray-900 dark:text-indigo-300 dark:shadow-[inset_0_0_0_1px_#4338ca]';
/** A tie's arrow: plain, and lit with the part it belongs to. */
export const ARROW = { lit: '#4f46e5', plain: '#818cf8' };
/** The × that takes a tie away, at rest. */
const UNTIE_LOOK = 'rounded-full bg-white text-indigo-600 shadow-[inset_0_0_0_1.5px_#6366f1] dark:bg-gray-900 dark:text-indigo-300';
const STEP_OFF = 'rounded-full bg-white text-gray-300 shadow-[inset_0_0_0_1px_#e5e7eb] dark:bg-gray-900 dark:text-gray-600 dark:shadow-[inset_0_0_0_1px_#374151]';

/**
 * A mark's or an arrow's name over it once the pointer rests on it, as every tooltip does (the owner, 2026-10-29): it
 * comes after a full second — 500 ms was «слишком рано» — and goes at once. A CSS label, not `Tooltip`: these are
 * buttons that act, and `Tooltip` pins itself on a click (.howto/show-a-tooltip.md).
 */
function HoverLabel({ text, from = 'middle' }: { text: string; from?: 'middle' | 'left' }) {
  return (
    <span aria-hidden="true" className={`pointer-events-none absolute bottom-[calc(100%+6px)] z-20 ${from === 'middle' ? 'left-1/2 -translate-x-1/2' : '-left-1'} whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 font-sans text-xs font-semibold text-white opacity-0 transition-opacity duration-150 invisible group-hover/tip:visible group-hover/tip:opacity-100 group-hover/tip:delay-1000 group-focus-visible/tip:visible group-focus-visible/tip:opacity-100 dark:bg-gray-700`}>
      {text}
    </span>
  );
}

/** ↵ or ↳ drawn small: on the marks over a word and in the panel's lines about them. */
function LevelGlyph({ level, size }: { level: CutLevel; size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={level === 'same' ? MARK_BREAK : MARK_UNDER} />
    </svg>
  );
}

/** A mark over a word: ↵ — the word and all after it on a new line of the same step; ↳ — on a new line one step under. */
function LevelMark({ level, onPress }: { level: CutLevel; onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <button type="button" aria-label={t(level === 'same' ? 'analysis.level.sameAria' : 'analysis.level.underAria')}
      onClick={(event) => { event.stopPropagation(); onPress(); }}
      className={`group/tip relative inline-flex h-5 w-[22px] items-center justify-center rounded-[5px] ${level === 'same' ? `${SAME_LOOK} hover:bg-indigo-700` : `${UNDER_LOOK} hover:bg-indigo-100 dark:hover:bg-indigo-950`}`}>
      <LevelGlyph level={level} size={13} />
      <HoverLabel text={t(level === 'same' ? 'analysis.level.same' : 'analysis.level.under')} />
    </button>
  );
}

/** The grey mark over a line's first word: glues the line back to the one above, as a press on the word does. */
function GlueMark({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <button type="button" aria-label={t('analysis.markGlue')} onClick={(event) => { event.stopPropagation(); onPress(); }}
      className="group/tip absolute -left-2 -top-3 z-10 hidden h-[18px] w-[18px] items-center justify-center rounded-[5px] bg-gray-500 text-white hover:bg-gray-700 group-hover:inline-flex">
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d={MARK_GLUE} /></svg>
      <HoverLabel text={t('analysis.markGlue')} />
    </button>
  );
}

/** ‹ or › left of a line: a step up or down, or pale and still where the line has nowhere to go. */
function StepButton({ side, onPress }: { side: 'up' | 'down'; onPress: (() => void) | null }) {
  const { t } = useTranslation();
  const label = t(side === 'up' ? 'analysis.level.up' : 'analysis.level.down');
  const Icon = side === 'up' ? ChevronLeftIcon : ChevronRightIcon;
  return (
    <button type="button" aria-label={label} disabled={!onPress} onClick={(event) => { event.stopPropagation(); onPress?.(); }}
      className={`group/tip relative inline-flex h-6 w-6 items-center justify-center border-[3px] border-transparent bg-clip-padding ${onPress ? `${STEP_LOOK} hover:bg-indigo-100 dark:hover:bg-indigo-950` : STEP_OFF}`}>
      <Icon className="h-3 w-3" strokeWidth={2.6} aria-hidden="true" />
      {onPress ? <HoverLabel text={label} /> : null}
    </button>
  );
}

/**
 * The two arrows left of a line, shown only while the pointer is on it (the owner, 2026-10-29: «если я никуда не навел,
 * то оно будет выглядеть как при просмотре»): both stand, the one with nowhere to go pale. Hidden they are `invisible`,
 * not only see-through, so their names stay out of the line's text when the lines are copied.
 */
function StepPair({ steps, left }: { steps: LineSteps; left: number }) {
  return (
    <span className="invisible absolute top-2.5 z-10 flex opacity-0 transition-opacity group-hover/line:visible group-hover/line:opacity-100" style={{ left }}>
      <StepButton side="up" onPress={steps.up} />
      <StepButton side="down" onPress={steps.down} />
    </span>
  );
}

/**
 * The × at the middle of a tie's arrow, while the pointer is on the arrow: the tie goes. Under the pointer it turns red
 * in both themes — the dark theme's own colours took the place of the hover's (the owner, 2026-10-29) — and its name
 * runs to the right: an arrow's upright stands in the margin, where a name centred over it was cut off at the edge.
 */
export function UntieMark({ x, y, onPress, onEnter, onLeave }: { x: number; y: number; onPress: () => void; onEnter: () => void; onLeave: () => void }) {
  const { t } = useTranslation();
  return (
    <button type="button" data-untie aria-label={t('analysis.untie')} onClick={(event) => { event.stopPropagation(); onPress(); }} onMouseEnter={onEnter} onMouseLeave={onLeave}
      className={`group/tip absolute z-30 -ml-[11px] -mt-[11px] inline-flex h-[22px] w-[22px] items-center justify-center ${UNTIE_LOOK} hover:bg-rose-600 hover:text-white hover:shadow-none dark:hover:bg-rose-600 dark:hover:text-white`}
      style={{ left: x, top: y }}>
      <XMarkIcon className="h-3 w-3" strokeWidth={2.6} aria-hidden="true" />
      <HoverLabel text={t('analysis.untie')} from="left" />
    </button>
  );
}

/**
 * The marks and arrows as the side panel names them: the same look, standing at the start of a line of text — a tie's
 * arrow and its × too, since words alone did not say what to look for (the owner, 2026-10-29).
 */
export function PanelGlyph({ kind }: { kind: CutLevel | 'up' | 'down' | 'glue' | 'tie' | 'untie' }) {
  if (kind === 'glue') {
    return (
      <span className="mr-1.5 inline-flex h-[18px] w-[18px] items-center justify-center rounded-[5px] bg-gray-500 align-[-3px] text-white">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d={MARK_GLUE} /></svg>
      </span>
    );
  }
  if (kind === 'tie') {
    return (
      <span className="mr-1.5 inline-flex h-[18px] w-[22px] items-center justify-center align-[-3px]">
        <svg viewBox="0 0 22 18" width="22" height="18" fill="none" stroke={ARROW.plain} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 16H7Q4 16 4 13V9Q4 6 7 6H13Q16 6 16 3V2" /><path d="M13.5 4.5 16 2l2.5 2.5" /><circle cx="19.5" cy="16" r="2.2" fill={ARROW.plain} stroke="none" />
        </svg>
      </span>
    );
  }
  if (kind === 'untie') return <span className={`mr-1.5 inline-flex h-[18px] w-[18px] items-center justify-center align-[-4px] ${UNTIE_LOOK}`}><XMarkIcon className="h-2.5 w-2.5" strokeWidth={2.6} aria-hidden="true" /></span>;
  if (kind === 'up' || kind === 'down') {
    const Icon = kind === 'up' ? ChevronLeftIcon : ChevronRightIcon;
    return <span className={`mr-1.5 inline-flex h-5 w-5 items-center justify-center align-[-5px] ${STEP_LOOK}`}><Icon className="h-[11px] w-[11px]" strokeWidth={2.6} aria-hidden="true" /></span>;
  }
  return <span className={`mr-1.5 inline-flex h-[18px] w-5 items-center justify-center rounded-[5px] align-[-3px] ${kind === 'same' ? SAME_LOOK : UNDER_LOOK}`}><LevelGlyph level={kind} size={12} /></span>;
}

/** A word pressed and dragged — any word, a line's first too: it links itself by meaning to the word it is dropped on. */
export type WordDrag = {
  down: (word: number, event: PointerEvent<HTMLSpanElement>) => void;
  move: (event: PointerEvent<HTMLSpanElement>) => void;
  up: (event: PointerEvent<HTMLSpanElement>) => void;
  cancel: () => void;
};
/** A line held by its dot and dragged: it is tied to the word it is dropped on — its step. */
export type LineDrag = Omit<WordDrag, 'down'> & { down: (start: number, event: PointerEvent<HTMLSpanElement>) => void };

/**
 * The dot just left of a line's first word, while the pointer is on the line (the owner's choice on the canvas, 30.10:
 * «точка возле слова, с левой стороны слова и ближе к слову»): where the line's tie arrow leaves. Held and dragged onto a
 * word, it ties the line to that word; the words themselves are dragged for links of meaning — a line's first word too,
 * so two lines' first words can be linked («испытывайте» and «узнавайте», 30.10).
 */
function LineHandle({ start, left, drag }: { start: number; left: number; drag: LineDrag }) {
  const { t } = useTranslation();
  // At rest the dot alone; under the pointer, and while held, a ring comes round it (the owner, 30.10: «без внешнего
  // круга, при hover появляется внешний круг»). The press is taken by a 16 px circle, wider than the dot.
  return (
    <span data-handle={start} role="button" aria-label={t('analysis.edit.handle')}
      onPointerDown={(event) => drag.down(start, event)} onPointerMove={drag.move} onPointerUp={drag.up} onPointerCancel={drag.cancel}
      className="group/tip invisible absolute top-[15px] z-10 flex h-4 w-4 cursor-grab touch-none items-center justify-center rounded-full opacity-0 transition-opacity active:cursor-grabbing group-hover/line:visible group-hover/line:opacity-100"
      style={{ left }}>
      <span aria-hidden="true" className="absolute inset-[1px] scale-50 rounded-full bg-indigo-500/10 opacity-0 shadow-[inset_0_0_0_1.5px_#818cf8] transition-[opacity,transform] duration-150 ease-out group-hover/tip:scale-100 group-hover/tip:opacity-100 group-active/tip:scale-100 group-active/tip:opacity-100 dark:bg-indigo-400/15" />
      <span aria-hidden="true" className="relative h-1.5 w-1.5 rounded-full bg-indigo-500 transition-colors group-hover/tip:bg-indigo-600 dark:bg-indigo-400 dark:group-hover/tip:bg-indigo-300" />
      <HoverLabel text={t('analysis.edit.handle')} from="left" />
    </span>
  );
}

/**
 * A part on its line: its words, and in «Правка» the arrows and the dot left of it. At rest a line in «Правка» looks as in
 * «Просмотр» (the owner, 2026-10-29): no number — ↵ ↳ over a word cut (a press on the word itself does not), a word held and dragged links it by meaning, the
 * dot held and dragged ties the line.
 */
export function AnalysisLine({ start, depth, role, words, steps, drag, handle, flags, painting, onWord, onCut, onGlue, onHoverWord }: {
  start: number; depth: number; role: LineRole; words: LineWord[]; steps: LineSteps | null; drag: WordDrag | null;
  /** The dot that ties the line, in «Правка» with no tool in hand. */
  handle?: LineDrag | null;
  /** The flags of the links of meaning with a word of this line, after its last word. */
  flags?: ReactNode;
  /** A marker, a pencil or the eraser in hand: a press paints, nothing is cut or dragged. */
  painting?: boolean;
  onWord: (index: number) => void; onCut: (index: number, level: CutLevel) => void;
  /** The mark over a line's first word: the line glued back to the one above. */
  onGlue: (index: number) => void;
  onHoverWord?: (index: number | null) => void;
}) {
  const pad = 8 + depth * 26;
  // Left of where the line starts — its first letter, or a verse number hung in the margin — the dot sits close, its centre
  // 9 px off, where the tie's arrow leaves; its ring under the pointer keeps 2 px from the letter. The arrows ‹ › stand left of it.
  const first = words[0]?.word;
  const lead = first?.startsVerse ? 6 + String(first.verse).length * 7 : 0;
  const edge = pad + 6 - lead;
  return (
    <div data-line={start} className={`group/line relative py-1 transition-opacity ${role === 'dim' ? 'opacity-30' : ''}`} style={{ paddingLeft: pad }}>
      {steps ? <StepPair steps={steps} left={edge - 66} /> : null}
      {handle ? <LineHandle start={start} left={edge - 17} drag={handle} /> : null}
      <span className={`rounded-lg px-1.5 py-0.5 font-serif text-[19px] leading-[1.75] [box-decoration-break:clone] ${drag || painting ? 'select-none' : ''} ${RING[role]}`}>
        {words.map((item) => <WordOfLine key={item.index} item={item} drag={drag} painting={painting} onWord={onWord} onCut={onCut} onGlue={onGlue} onHoverWord={onHoverWord} />)}
        {flags}
      </span>
    </div>
  );
}

/** What stands over a word while the pointer is on it: ↵ and ↳ over a word inside a line, «склеить» over its first word. */
function WordMarks({ item, onCut, onGlue }: { item: LineWord; onCut: (index: number, level: CutLevel) => void; onGlue: (index: number) => void }) {
  if (item.mark === 'glue') return <GlueMark onPress={() => onGlue(item.index)} />;
  if (item.mark !== 'break') return null;
  return (
    <span className="absolute -left-2.5 -top-[15px] z-10 hidden gap-[3px] group-hover:inline-flex">
      <LevelMark level="same" onPress={() => onCut(item.index, 'same')} />
      <LevelMark level="under" onPress={() => onCut(item.index, 'under')} />
    </span>
  );
}

/** A verse's number before the word that starts it; one that opens a line hangs in the margin left of it. */
function VerseNumber({ item }: { item: LineWord }) {
  // Hung (the owner, 2026-10-29): taking room in the line it pushed the first letter right of the lines on its step,
  // and the indent is what says the step.
  return (
    <sup data-lead={item.leads ? item.index : undefined}
      className={`pr-0.5 font-sans text-[11px] font-bold text-indigo-500 ${item.leads ? 'pointer-events-none absolute right-full top-0 leading-none' : ''}`}>
      {item.word.verse}
    </sup>
  );
}

const TARGET_LOOK = { yes: 'bg-indigo-100 ring-2 ring-indigo-500 dark:bg-indigo-900', no: 'bg-rose-100 dark:bg-rose-950' };

function WordOfLine({ item, drag, painting, onWord, onCut, onGlue, onHoverWord }: {
  item: LineWord; drag: WordDrag | null; painting?: boolean; onWord: (index: number) => void; onCut: (index: number, level: CutLevel) => void;
  onGlue: (index: number) => void;
  onHoverWord?: (index: number | null) => void;
}) {
  const look = [
    painting ? 'cursor-crosshair' : 'cursor-pointer',
    item.mark ? 'hover:bg-indigo-50 dark:hover:bg-indigo-950' : '',
    item.target ? TARGET_LOOK[item.target] : '',
    // The marker's colour gives way to a drop target's; the pencil's line to the indigo line of a part on the lit way.
    item.target ? '' : (item.fill ?? ''),
    item.onPath ?'underline decoration-indigo-600 decoration-2 underline-offset-4' : (item.pencil ?? ''),
    item.ring ? `ring-2 ${item.ring}` : '',
  ].join(' ');
  // Held and dragged, any word links itself by meaning to the word it is dropped on.
  const held = painting ? null : drag;
  const hover = item.linked && onHoverWord ? { onMouseEnter: () => onHoverWord(item.index), onMouseLeave: () => onHoverWord(null) } : {};
  return (
    <span className={item.leads && item.word.startsVerse ? 'relative' : undefined}>
      {item.word.startsVerse ? <VerseNumber item={item} /> : null}
      <span data-word={item.index} onClick={() => onWord(item.index)} {...hover}
        onPointerDown={held ? (event) => held.down(item.index, event) : undefined} onPointerMove={held?.move} onPointerUp={held?.up} onPointerCancel={held?.cancel}
        className={`group relative rounded ${look}`}>
        <WordMarks item={item} onCut={onCut} onGlue={onGlue} />
        {/* The middle of the small letters (vertical-align: middle): where a tie's arrow leaves the line. */}
        {item.leads ? <span data-mid={item.index} aria-hidden="true" className="inline-block h-0 w-0 align-middle" /> : null}
        {item.word.text}
      </span>
      {item.last ? null : ' '}
    </span>
  );
}
