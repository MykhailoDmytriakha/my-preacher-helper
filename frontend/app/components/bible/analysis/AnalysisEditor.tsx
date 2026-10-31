'use client';

import { ChevronDownIcon } from '@heroicons/react/20/solid';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { PHASES_TAKING_CHANGES } from '@/data-engine/react.client';
import { useModalLayer } from '@/hooks/useModalLayer';
import {
  cutAt, depthOf, dropTie, glueAt, holderOf, holdersOf, needsArrow, partEnd, partOf, partsOn, partStarts,
  partText, stepDown, stepUp, tieTo, tieTurns, type AnalysisState, type AnalysisWord, type CutLevel,
} from '@/utils/passageAnalysis';
import { passageCopyText } from '@/utils/verseCopy';

import { useCopyNames } from '../verseCopy/useVerseCopy';

import { writeAnalysisAddress } from './analysisAddress';
import { arrowNear, dragArrow, fromLine, tieArrows, useGeometry, type Arrow } from './analysisGeometry';
import { saveAnalysisHelpPrefs, useAnalysisHelpPrefs } from './analysisHelpPrefs';
import {
  ARROW, AnalysisHeader, AnalysisLine, PanelGlyph, UntieMark, type AnalysisMode, type LineDrag, type LineRole, type LineSteps, type LineWord, type WordDrag,
} from './AnalysisParts';
import { AnalysisSermons, AnalysisSermonsPanel } from './AnalysisSermons';
import { RelationGlyph } from './RelationParts';
import { useAnalysisMarks, type AnalysisMarks } from './useAnalysisMarks';
import { useAnalysisNote, type AnalysisOpening } from './useAnalysisNote';
import { useAnalysisRelations } from './useAnalysisRelations';
import { useUndoShortcut } from './useUndoShortcut';

import type { PickedPassage } from '../verseCopy/passagePick';
import type { AppLocale } from '@/utils/appLocale';
import type { BibleId } from '@/utils/bibles';
import type { BookText } from '@/utils/bibleText';

export type { AnalysisOpening } from './useAnalysisNote';

/**
 * What is held: `tie` — a line by its dot, tying the line (`blocked` — the line already has a tie's arrow, which goes by
 * its × first; `from` — the line's first word); `relate` — a word, linking it by meaning to the word it is dropped on.
 */
type Drag = { kind: 'tie' | 'relate'; from: number; startX: number; startY: number; moved: boolean; x: number; y: number; target: number | null; blocked: boolean };
type Message = { text: string; warn: boolean } | null;

/** The mode it opens in: «Просмотр» when reopened there from the address, cuts or not (Codex, 30.10); else «Правка». */
const firstMode = (opening: AnalysisOpening): AnalysisMode => (opening.kind === 'open' && opening.editing === false ? 'view' : 'edit');

/** How each part stands in «Просмотр»: the chosen one, the way up from it, what hangs on it; in «Правка» all as they are. */
function roleOf(state: AnalysisState, mode: AnalysisMode, selected: number | null, start: number): LineRole {
  if (mode === 'edit' || selected === null) return 'plain';
  if (start === selected) return 'focus';
  if (holdersOf(state, selected).includes(start)) return 'path';
  return partsOn(state, selected).includes(start) ? 'kid' : 'dim';
}

/**
 * A PASSAGE'S ANALYSIS, OVER THE READER (case 2026-10-12-block-diagram, 3.4; accepted on the canvas «Разбор структуры»,
 * 2026-10-29). Two modes: «Правка» — at rest it looks as «Просмотр» (the owner, 2026-10-29); the marks over a word start a
 * new line on the same step (↵) or one step under (↳) — a press on the word itself cuts nothing (the owner, 31.10), the mark over a line's first word glues it
 * back, the arrows left of the line under the pointer move it a step up or down, a word held and dragged onto another
 * word ties its line to that word, any other word dragged onto a word links the two by meaning (`useAnalysisRelations`),
 * and the × at a tie's arrow takes the tie away; and «Просмотр» — a part pressed lights its way up to the main thought.
 * In both the reader's marker, pencil and eraser paint the words (`useAnalysisMarks`). An analysis that exists opens for
 * viewing, a new one for editing. The rules are `utils/passageAnalysis.ts`; the note behind it is `useAnalysisNote`.
 */
export function AnalysisEditor({ opening, text, bookId, bible, locale, marks: lentMarks, onClose, onEditVerses, onOpenScreen }: {
  opening: AnalysisOpening; text: BookText; bookId: string; bible: BibleId; locale: AppLocale; onClose: () => void;
  /** Another screen of the app opened from here (a sermon made from this analysis), the reader's way. */
  onOpenScreen?: (href: string) => void;
  /** The reader's marks of this book, or nothing (signed out, or not read yet). */
  marks?: AnalysisMarks | null;
  /** Its verses chosen again in the reader: the note it is kept in (none yet for an untouched new one) and its passage. */
  onEditVerses?: (id: string | null, passage: PickedPassage) => void;
}) {
  const { t } = useTranslation();
  const note = useAnalysisNote({ opening, text, bookId, bible, locale });
  const copyNames = useCopyNames(bible, bookId);
  const { words, total, state, place } = note;
  const [mode, setMode] = useState<AnalysisMode>(() => firstMode(opening));
  const [selected, setSelected] = useState<number | null>(null);
  const [overArrow, setOverArrow] = useState<number | null>(null);
  const leaveArrow = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const justDragged = useRef(false);
  const { contentRef, geometry, at } = useGeometry();
  const keepsEditing = opening.kind === 'open' && opening.editing === true;
  useEffect(() => { if (note.opensForViewing && !keepsEditing) setMode('view'); }, [note.opensForViewing, keepsEditing]);
  useEffect(() => () => clearTimeout(leaveArrow.current), []);

  const starts = partStarts(state);
  const change = (next: AnalysisState, said: Message = null) => { note.change(next); setMessage(said); };
  const short = (start: number) => { const all = partText(words, state, start).replace(/[,.;:]$/, ''); return all.length > 42 ? `${all.slice(0, 40).replace(/\s+\S*$/, '')}…` : all; };
  const bare = (word: number) => (words[word]?.text ?? '').replace(/[,.;:!?]$/, '');
  const [allLinks, setAllLinks] = useState(false);
  const relations = useAnalysisRelations({ state, total, geometry, at, bare, editing: mode === 'edit', showAll: mode === 'view' && allLinks, change, say: setMessage });
  const marks = useAnalysisMarks({ source: lentMarks ?? null, words });

  const close = useCallback(() => { note.flush(); onClose(); }, [note, onClose]);
  // Escape lets go of one thing at a time: a link's menu, a drag, the lit part — then the screen. The tool in hand is
  // put away by its own bar (`MarkToolbar`), which spends that press.
  const { letGo } = relations;
  const escape = useCallback(() => {
    if (letGo()) return;
    if (drag) { setDrag(null); return; }
    if (selected === null) { close(); return; }
    setSelected(null); setMessage(null);
  }, [close, drag, letGo, selected]);
  const layer = useModalLayer({ onClose: escape });
  const undo = () => { note.undo(); setMessage(null); };
  useUndoShortcut(mode === 'edit', undo, contentRef);
  useAnalysisAddress(note.id, mode, note.missing, onClose);

  // A mark over a word: ↵ — a new line on the same step as the line it is cut from, ↳ — one step under it.
  const cutWord = (word: number, level: CutLevel) => { const next = cutAt(state, word, total, level); if (next) change(next); };
  // A word pressed: in «Просмотр» its part lights up. In «Правка» a press cuts and glues nothing — a line is cut only by ↵ ↳
  // over a word and glued only by the mark over its first word (the owner, 31.10: a press on a word picked out by a link or a
  // mark cut the line unasked — «только по кнопкам»). A press that ended a drag is not a press.
  const pressWord = (word: number) => {
    if (justDragged.current) { justDragged.current = false; return; }
    if (marks.painting) return;
    // In «Правка» a linked word — the one ringed — opens its links' menu (the owner, 31.10).
    if (mode !== 'view') { relations.pressWord(word); return; }
    const start = partOf(state, word);
    setSelected(selected === start ? null : start);
  };
  const glueLine = (start: number) => change(glueAt(state, start, total));

  // A line held by its dot and dragged ties the line to the word it is dropped on (the owner's choice on the canvas,
  // 30.10: two lines' first words could not be linked by meaning while the first word carried the tie). A line has one
  // such tie: while its arrow stands, the line is not dragged — its × takes the tie away first. Any word held and dragged,
  // a line's first too, links itself by meaning to the word it is dropped on; a short press changes nothing.
  const wordAt = (x: number, y: number) => {
    const hit = document.elementFromPoint(x, y)?.closest('[data-word]');
    return hit ? Number(hit.getAttribute('data-word')) : null;
  };
  const tie = (start: number, word: number | null) => {
    const tied = word === null ? 'own' : tieTo(state, start, word, total);
    if (tied === 'own') { setMessage({ text: t('analysis.tie.miss'), warn: false }); return; }
    const done = { part: short(start), word: bare(word!), lifted: short(partOf(state, word!)) };
    change(tied, { text: t(tieTurns(state, start, word!) ? 'analysis.tie.turned' : 'analysis.tie.done', done), warn: false });
  };
  const startDrag = (kind: Drag['kind'], from: number, event: PointerEvent<HTMLSpanElement>) => {
    // A mark over the word is pressed as itself: held by the word, its press went to the word and cut as ↵.
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDrag({ kind, from, startX: event.clientX, startY: event.clientY, moved: false, x: 0, y: 0, target: null, blocked: kind === 'tie' && needsArrow(state, from) });
  };
  const wordDrag: WordDrag = {
    down: (word, event) => startDrag('relate', word, event),
    move: (event) => {
      if (!drag) return;
      if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
      if (drag.blocked) {
        if (!drag.moved) { setDrag({ ...drag, moved: true }); setMessage({ text: t('analysis.tie.has'), warn: true }); }
        return;
      }
      const point = at(event.clientX, event.clientY);
      setDrag({ ...drag, moved: true, x: point.x, y: point.y, target: wordAt(event.clientX, event.clientY) });
    },
    // A pull the page takes for a scroll ends the drag with nothing made (Codex's hunt, 2026-10-30: it stayed on, the
    // marks over the words hidden, until another press).
    cancel: () => setDrag(null),
    up: (event) => {
      const was = drag;
      setDrag(null);
      if (!was?.moved) return;
      justDragged.current = true;
      if (was.kind === 'relate') relations.relate(was.from, wordAt(event.clientX, event.clientY));
      else if (!was.blocked) tie(was.from, wordAt(event.clientX, event.clientY));
    },
  };
  const lineDrag: LineDrag = { ...wordDrag, down: (start, event) => startDrag('tie', start, event) };

  // A tie's arrow under the pointer shows its ×; moving from the arrow onto the × does not take it away.
  const overArrowOn = (start: number) => { clearTimeout(leaveArrow.current); setOverArrow(start); };
  const overArrowOff = () => { clearTimeout(leaveArrow.current); leaveArrow.current = setTimeout(() => setOverArrow(null), 350); };
  const pointArrows = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-untie]')) return;
    const point = at(event.clientX, event.clientY);
    const near = target.closest('button') ? null : arrowNear(ties, [point.x, point.y]);
    if (near !== null) overArrowOn(near);
    else if (overArrow !== null) overArrowOff();
  };
  const untie = (start: number) => {
    setOverArrow(null);
    const next = dropTie(state, start, total);
    const holder = holderOf(next, start);
    change(next, { text: holder === null ? t('analysis.tie.droppedTop', { part: short(start) }) : t('analysis.tie.dropped', { part: short(start), holder: short(holder) }), warn: false });
  };

  // The arrows left of a line: each live only where the part has somewhere to go.
  const stepsOf = (start: number): LineSteps | null => {
    if (mode !== 'edit') return null;
    const up = stepUp(state, start, total);
    const down = stepDown(state, start, total);
    return { up: up ? () => change(up) : null, down: down ? () => change(down) : null };
  };

  // A press on empty space lets go of the lit part.
  const pressBackground = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('[data-word],button,[data-relation-menu],[data-handle]')) return;
    relations.letGo();
    setSelected(null); setMessage(null);
  };

  // Arrows only where the indent does not already say it; a lit part's arrow lights with it.
  const arrows = useMemo(() => {
    const out: Arrow[] = tieArrows(state, geometry, (start) => {
      const role = roleOf(state, mode, selected, start);
      return role === 'focus' || role === 'path' || role === 'kid' || (mode === 'edit' && overArrow === start);
    });
    const from = drag?.moved && drag.kind === 'tie' ? fromLine(geometry, drag.from) : undefined;
    if (drag && from && !drag.blocked) out.push(dragArrow(from, drag));
    return out;
  }, [drag, geometry, mode, overArrow, selected, state]);
  const ties = mode === 'edit' && !drag ? arrows.filter((arrow) => arrow.start !== undefined) : [];
  const untieAt = ties.find((arrow) => arrow.start === overArrow);

  const wordsOf = (start: number): LineWord[] => {
    const end = partEnd(state, start, total);
    // While a word is dragged, or a tool is in hand, the marks over the words stay away.
    const cutMarks = mode === 'edit' && !drag?.moved && !marks.painting;
    const chosen = mode === 'view' ? selected : null;
    const onPath = (index: number) => chosen !== null && (state.links[chosen] === index || holdersOf(state, chosen).some((holder) => state.links[holder] === index));
    const target = (index: number): LineWord['target'] => {
      if (!drag?.moved || drag.blocked || drag.target !== index) return null;
      if (drag.kind === 'relate') return index === drag.from ? 'no' : 'yes';
      return partOf(state, index) === drag.from ? 'no' : 'yes';
    };
    return words.slice(start, end).map((word: AnalysisWord, k) => {
      const index = start + k;
      const mark = cutMarks && index !== 0 ? (index === start ? 'glue' : 'break') : null;
      return { index, word, mark, target: target(index), onPath: onPath(index), leads: index === start, last: index === end - 1,
        ...marks.paintOf(index), ring: relations.ringOf(index), linked: relations.linked(index) };
    });
  };

  if (typeof document === 'undefined') return null;

  const title = t('analysis.title', { place });
  // Only a kept analysis can be named by a sermon; an untouched new one has no note yet.
  const analysisId = note.noteId();
  const sermons = onOpenScreen && analysisId ? {
    noteId: analysisId, place, verse: note.passage ? passageCopyText(text.chapters, note.passage, copyNames) : '',
    onOpen: (href: string) => { note.flush(); onOpenScreen(href); },
  } : null;

  return createPortal(
    <div {...layer} role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[120] flex flex-col bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <AnalysisHeader title={title} parts={t('analysis.partCount', { count: starts.length })} mode={mode}
        onMode={(value) => { setMode(value); setSelected(null); setMessage(null); }}
        canUndo={note.canUndo} onUndo={undo} onClose={close} tools={marks.toolbar}
        allLinks={mode === 'view' && state.relations.length ? { on: allLinks, onToggle: () => setAllLinks(!allLinks) } : null}
        onEditVerses={onEditVerses && note.passage ? () => { note.flush(); onEditVerses(note.noteId(), note.passage!); } : undefined}
        // On a screen without the side panel the sermons stand by the name; with it, in the panel (the owner, 31.10).
        sermons={sermons ? <span className="lg:hidden"><AnalysisSermons {...sermons} /></span> : null} />
      <div className="flex min-h-0 flex-1">
        {/* The top padding leaves room for a mark's name over the first line, the left one for a top line's two arrows and
            its dot — past a two-digit verse number hung in the margin. */}
        <div className={`min-w-0 flex-1 overflow-auto px-4 pb-24 pt-10 sm:pl-20 sm:pr-12 ${marks.paneClass}`}
          onClick={pressBackground} onMouseMove={pointArrows} onMouseLeave={overArrowOff} {...marks.strokeEvents}>
          <AnalysisNotices ready={note.ready} changedText={note.changedText} sync={note.sync} refused={note.refused} onSaveAgain={note.saveAgain} />
          <div ref={contentRef} className="relative">
            {arrows.map((arrow) => (
              <svg key={arrow.key} data-arrow={arrow.key} aria-hidden="true" width={geometry.width || 1} height={geometry.height || 1} className="pointer-events-none absolute left-0 top-0 overflow-visible">
                <path d={arrow.d} fill="none" stroke={arrow.lit ? ARROW.lit : ARROW.plain} strokeWidth={arrow.lit ? 2 : 1.7} strokeLinecap="round" />
                <path d={arrow.head} fill="none" stroke={arrow.lit ? ARROW.lit : ARROW.plain} strokeWidth={arrow.lit ? 2 : 1.7} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ))}
            {relations.arrows.map((arrow) => (
              <svg key={arrow.key} data-relation-arrow={arrow.key} data-strong={arrow.strong || undefined} aria-hidden="true" width={geometry.width || 1} height={geometry.height || 1} className={`pointer-events-none absolute left-0 top-0 overflow-visible ${arrow.stroke}`}>
                <path d={arrow.d} fill="none" strokeWidth={arrow.strong ? 3.4 : 2.2} strokeLinecap="round" />
                {arrow.heads.map((head) => <path key={head} d={head} fill="none" strokeWidth={arrow.strong ? 3.4 : 2.2} strokeLinecap="round" strokeLinejoin="round" />)}
              </svg>
            ))}
            {relations.dragLine(drag?.moved && drag.kind === 'relate' ? drag : null)}
            {starts.map((start) => (
              <AnalysisLine key={start} start={start} depth={depthOf(state, start)} role={roleOf(state, mode, selected, start)}
                words={wordsOf(start)} steps={stepsOf(start)} drag={mode === 'edit' ? wordDrag : null} handle={mode === 'edit' && !marks.painting ? lineDrag : null}
                flags={relations.flagsOf(start)} painting={marks.painting}
                onWord={pressWord} onCut={cutWord} onGlue={glueLine} onHoverWord={relations.pointWord} />
            ))}
            {untieAt?.mid ? <UntieMark x={untieAt.mid.x} y={untieAt.mid.y} onPress={() => untie(untieAt.start!)} onEnter={() => overArrowOn(untieAt.start!)} onLeave={overArrowOff} /> : null}
            {relations.menuNode}
          </div>
        </div>
        <aside className="hidden w-80 shrink-0 flex-col gap-3 overflow-auto border-l border-gray-200 p-5 text-sm dark:border-gray-800 lg:flex">
          <AnalysisPanel mode={mode} state={state} selected={selected} short={short} bare={bare} />
          {sermons ? <div className="mt-3 border-t border-gray-200 pt-4 dark:border-gray-800"><AnalysisSermonsPanel {...sermons} /></div> : null}
          {message ? <div className={`rounded-xl px-3 py-2 leading-relaxed ${message.warn ? 'bg-rose-50 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200' : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200'}`}>{message.text}</div> : null}
        </aside>
      </div>
    </div>,
    document.body,
  );
}

/**
 * The open analysis in the page's address while its note exists, in its mode, gone from it when the screen closes
 * (`analysisAddress.ts`). An analysis on no copy this device can reach (`gone`) closes the screen; one deleted elsewhere
 * with work still here stays, and the note's status asks what to keep.
 */
function useAnalysisAddress(id: string | null, mode: AnalysisMode, gone: boolean, onClose: () => void) {
  useEffect(() => { if (id) writeAnalysisAddress({ id, mode }); }, [id, mode]);
  useEffect(() => () => writeAnalysisAddress(null), []);
  useEffect(() => { if (gone) onClose(); }, [gone, onClose]);
}

/**
 * What stands over the text when something is off: the analyses still being read, a changed text, and what the note's
 * form needs from the person — a refusal or a version from elsewhere, with the engine's own choices (keep mine, take the
 * server's, try again). The app-wide notice stands behind this screen, so it is said here.
 */
function AnalysisNotices({ ready, changedText, sync, refused, onSaveAgain }: {
  ready: boolean; changedText: boolean; sync: ReturnType<typeof useAnalysisNote>['sync']; refused: boolean; onSaveAgain: () => void;
}) {
  const { t } = useTranslation();
  const decision = sync && !PHASES_TAKING_CHANGES.has(sync.status?.phase ?? 'saved');
  return (
    <>
      {refused ? (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
          <span className="min-w-0 flex-1">{t('analysis.notKept')}</span>
          <button type="button" onClick={onSaveAgain} className="h-8 rounded-lg bg-white px-3 font-semibold text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100 dark:bg-rose-950 dark:text-rose-200 dark:ring-rose-800">{t('analysis.saveAgain')}</button>
        </div>
      ) : null}
      {ready || decision || refused ? null : <p role="status" className="mb-4 rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:bg-gray-900 dark:text-gray-300">{t('analysis.loading')}</p>}
      {changedText ? <p className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{t('analysis.changedText')}</p> : null}
      {sync ? (
        <DataSyncStatus subject={sync.recoveryIdentity} status={sync.status} error={sync.state ? null : sync.error} className="mb-4"
          onRetry={() => sync.retry()} onKeepLocal={() => sync.keepLocal()} onAcceptRemote={() => sync.acceptRemote()} />
      ) : null}
    </>
  );
}

/**
 * The side panel: what to do now — divide the passage and tie its parts, or read the chosen one. Its help folds (the owner,
 * 31.10: «поначалу она нужна, а потом ты уже выучиваешь»): in full at first, each tool one line — its sign and a short
 * name — once folded, the choice kept on the device (`analysisHelpPrefs.ts`). What the chosen part holds is not help: it
 * stays.
 */
function AnalysisPanel({ mode, state, selected, short, bare }: {
  mode: AnalysisMode; state: AnalysisState; selected: number | null;
  short: (start: number) => string; bare: (word: number) => string;
}) {
  const { t } = useTranslation();
  const help = useAnalysisHelpPrefs();
  const hint = 'leading-relaxed text-gray-600 dark:text-gray-300';
  const line = 'flex items-start gap-1 leading-snug text-gray-600 dark:text-gray-300';
  const head = (title: string) => (
    <div className="flex items-center justify-between gap-2">
      <div className="text-[15px] font-bold">{title}</div>
      <button type="button" aria-expanded={!help.short} data-testid="analysis-help-toggle" onClick={() => saveAnalysisHelpPrefs({ short: !help.short })}
        className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/50">
        {t(help.short ? 'analysis.help.expand' : 'analysis.help.collapse')}
        <ChevronDownIcon className={`h-3.5 w-3.5 transition-transform ${help.short ? '' : 'rotate-180'}`} aria-hidden="true" />
      </button>
    </div>
  );
  if (mode === 'edit') {
    if (help.short) {
      return (
        <>
          {head(t('analysis.edit.title'))}
          <div data-testid="analysis-help-short" className="flex flex-col gap-2">
            <p className={line}><PanelGlyph kind="same" />{t('analysis.help.same')}</p>
            <p className={line}><PanelGlyph kind="under" />{t('analysis.help.under')}</p>
            <p className={line}><PanelGlyph kind="glue" />{t('analysis.help.glue')}</p>
            <p className={line}><PanelGlyph kind="up" />{t('analysis.help.up')}</p>
            <p className={line}><PanelGlyph kind="down" />{t('analysis.help.down')}</p>
            <p className={line}><PanelGlyph kind="tie" />{t('analysis.help.tie')}</p>
            <p className={line}><PanelGlyph kind="untie" />{t('analysis.help.untie')}</p>
            <p className={line}><RelationGlyph />{t('analysis.help.relation')}</p>
          </div>
        </>
      );
    }
    return (
      <>
        {head(t('analysis.edit.title'))}
        <p className={hint}>{t('analysis.edit.hintMark')}</p>
        <p className={hint}><PanelGlyph kind="same" />{t('analysis.edit.markSame')}</p>
        <p className={hint}><PanelGlyph kind="under" />{t('analysis.edit.markUnder')}</p>
        <p className={hint}><PanelGlyph kind="glue" />{t('analysis.edit.hintGlue')}</p>
        <p className={hint}>{t('analysis.edit.hintSteps')}</p>
        <p className={hint}><PanelGlyph kind="up" />{t('analysis.edit.stepUp')}</p>
        <p className={hint}><PanelGlyph kind="down" />{t('analysis.edit.stepDown')}</p>
        <p className={hint}><PanelGlyph kind="tie" />{t('analysis.edit.hintTie')}</p>
        <p className={hint}><PanelGlyph kind="untie" />{t('analysis.edit.hintUntie')}</p>
        <p className={hint}><RelationGlyph />{t('analysis.edit.hintRelation')}</p>
      </>
    );
  }
  const word = selected !== null ? state.links[selected] : undefined;
  return (
    <>
      {head(t('analysis.modeView'))}
      <p className={hint}>{t(help.short ? 'analysis.help.view' : 'analysis.view.hint')}</p>
      {selected !== null ? (
        <div className="flex flex-col gap-1.5 rounded-xl bg-gray-50 p-3 dark:bg-gray-900">
          <div className="font-serif text-[15px]">{short(selected)}</div>
          <div className={hint}>{word !== undefined ? t('analysis.view.hangs', { word: bare(word), part: short(partOf(state, word)) }) : t('analysis.view.top')}</div>
          <div className={hint}>{t('analysis.view.kids', { count: partsOn(state, selected).length })}</div>
          <div className={hint}>{t('analysis.view.steps', { count: holdersOf(state, selected).length })}</div>
        </div>
      ) : null}
    </>
  );
}
