'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { toast } from 'sonner';


import { hasOpenLayer } from '@/hooks/useModalLayer';
import { recordDiagnostic } from '@/utils/appDiagnostics';
import { resolveAppLocale } from '@/utils/appLocale';
import { getLocalizedAbbrev } from '@/utils/bibleBooks';
import { BIBLES, bibleForLocale, type BibleId } from '@/utils/bibles';
import { verseWords, type BookText } from '@/utils/bibleText';
import { copyPlainText } from '@/utils/clipboard';
import { isTypingIn } from '@/utils/typingTarget';
import { copiedPlace, DEFAULT_COPY_FORMAT, verseCopyText, type CopyFormat, type CopyNames } from '@/utils/verseCopy';
import { useTranslation } from '@locales/useTranslation';

import { VERSE_CHOSEN_ATTRIBUTE, VERSE_HELD_ATTRIBUTE, type RibbonCrossRefs, type RibbonVerseMenu } from '../BookRibbon';

import { bookIndex, pickedPassage, pulledEnd, stretchPassage, versesBetween } from './passagePick';
import { selectedVerses, verseKey, type VerseAt } from './selectedVerses';

import type { TFunction } from 'i18next';

/**
 * Where the verse's menu was asked for: the press, the row as it stood, whether a finger asked, and whether a hold
 * opened it — the click that ends a hold may land on the menu.
 */
export type VerseMenuAt = VerseAt & { x: number; y: number; touch: boolean; held: boolean; opener?: HTMLElement | null; row: { top: number; left: number; width: number; height: number } };

/**
 * The book named in the Bible's own language, whatever the interface speaks: the words copied are that Bible's. The Bible
 * itself is named — by its short mark in the interface's language — only when it is not the Bible of the interface's
 * language (the owner, 2026-10-27), like every reference mark in the app.
 */
export function copyNamesOf(bible: BibleId, bookId: string, interfaceLanguage: string, t: TFunction): CopyNames {
  const book = getLocalizedAbbrev(bookId, BIBLES[bible].language);
  return bibleForLocale(resolveAppLocale(interfaceLanguage)) === bible ? { book } : { book, mark: t(`bible.translations.${bible}.short`) };
}

/** `copyNamesOf` for the book being read. */
export function useCopyNames(bible: BibleId, bookId: string): CopyNames {
  const { t, language } = useTranslation();
  return useMemo(() => copyNamesOf(bible, bookId, language, t), [bible, bookId, language, t]);
}

const subscribeNever = () => () => undefined;
const PASSAGE_HINT = 'analysis-passage-hint';
/** One toast for the passage's rule, however many presses or pulls run into it. */
const PASSAGE_LIMIT = 'passage-limit';

/** What a passage is chosen for: an analysis, or a comment — a paragraph when it runs over more than one verse. */
export type PassagePurpose = 'analysis' | 'comment';
const PASSAGE_HINTS: Record<PassagePurpose, string> = { analysis: 'analysis.pick.hint', comment: 'comment.pick.hint' };
/** A paragraph's verses are chosen up to its last one. */
const PARAGRAPH_HINT = 'comment.pick.paragraphHint';
/**
 * A rule a passage keeps beside running on (`commentParagraphs.ts` for a comment): given the verses a press made and the
 * end it moved, the verses allowed and, when they differ, what to say.
 */
/** `asParagraph` — what the window whose verses are chosen says the comment is now; undefined — no window yet. */
export type PassageLimit = (verses: VerseAt[], end: 'first' | 'last' | null, before: VerseAt[], asParagraph?: boolean) => { verses: VerseAt[]; said?: string };
const canShareNow = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function';

function setOnRows(root: HTMLElement | null, attribute: string, keys: ReadonlySet<string>) {
  if (!root) return;
  for (const row of root.querySelectorAll(`[${attribute}]`)) {
    if (!keys.has(row.getAttribute('data-verse') ?? '')) row.removeAttribute(attribute);
  }
  for (const key of keys) root.querySelector(`[data-verse="${key}"]`)?.setAttribute(attribute, '');
}

/**
 * TAKING VERSES OUT OF THE READER (the owner, 2026-10-27, canvas «Копировать стих»): a verse held — or pressed
 * with the right mouse button — opens its menu; «Выбрать несколько» turns presses into choosing verses for the
 * bar; a selection copied by the system's own Copy carries the clean words and the place. The text a copy holds
 * is `utils/verseCopy.ts`. The rows' lights are set on the rows themselves, like the arrival: the ribbon is not
 * drawn again for a choice.
 */
/**
 * How long after a grip is let go a click is still that pull's. Safari on the owner's iPad sent it 39 ms after the
 * Pencil's lift (technical report, 01.11); a click a person makes half a second later, with no press before it (an
 * assistive device's), is that person's (Codex review, 01.11). Any new press or key on the text ends the wait at once.
 */
const PULL_CLICK_MS = 500;

/**
 * The technical report's line for a change of the chosen passage (`appDiagnostics`, «verse-pick»): what changed it and
 * how each end went — «first-later-last-same» — and how long after a grip was let go; never which verses.
 */
function recordPick(text: BookText, source: string, before: readonly VerseAt[], after: readonly VerseAt[], sincePull: number) {
  const ends = (verses: readonly VerseAt[]) => (verses.length ? [Math.min(...verses.map((at) => bookIndex(text, at))), Math.max(...verses.map((at) => bookIndex(text, at)))] : null);
  const was = ends(before);
  const now = ends(after);
  if (!was || !now || (was[0] === now[0] && was[1] === now[1])) return;
  const way = (from: number, to: number) => (to === from ? 'same' : to > from ? 'later' : 'earlier');
  recordDiagnostic('verse-pick', { source, result: `first-${way(was[0], now[0])}-last-${way(was[1], now[1])}`, ...(sincePull < 10_000 ? { elapsedMs: sincePull } : {}) });
}

export function useVerseCopy({ textRef, text, bible, bookId, drawn, crossRefs, enabled, onActed, limitComment }: {
  textRef: RefObject<HTMLElement | null>;
  text: BookText | null;
  bible: BibleId;
  bookId: string;
  /** The chapters drawn of a big book: rows come and go, and their lights are set again. */
  drawn?: unknown;
  crossRefs?: RibbonCrossRefs;
  /** Off while a mark tool is in hand: a press then paints. */
  enabled: boolean;
  /** Verses acted on — a menu opened, copied, sent — in the order chosen (the reader puts them on the trail). */
  onActed?: (verses: VerseAt[]) => void;
  /** The paragraphs' rule while verses are chosen for a comment. */
  limitComment?: PassageLimit;
}) {
  const { t, language } = useTranslation();
  const locale = resolveAppLocale(language);
  const names = useCopyNames(bible, bookId);
  const canShare = useSyncExternalStore(subscribeNever, canShareNow, () => false);
  const [menu, setMenu] = useState<VerseMenuAt | null>(null);
  const [picked, setPicked] = useState<VerseAt[] | null>(null);
  // What the verses are chosen for: a copy, or a passage to analyse — one running piece of text (case
  // 2026-10-12-block-diagram, 3.4). One choosing for both, so the rows' lights and the presses are the same.
  const [purpose, setPurpose] = useState<'copy' | PassagePurpose>('copy');
  const [format, setFormat] = useState<CopyFormat | null>(null);
  const [held, setHeld] = useState<VerseAt | null>(null);
  // What the comment whose verses are chosen is: a paragraph, a comment, or not said (an analysis, a copy).
  const [asParagraph, setAsParagraph] = useState<boolean | undefined>(undefined);

  const purposeRef = useRef(purpose);
  purposeRef.current = purpose;
  // A grip's pull under way — the run as it found it and as it is now — and the click its pointer may send after the lift
  // (the owner, 01.11, iPad: the finger lifted from the last grip, and Safari's click took the first verse off).
  const pulling = useRef<{ end: 'first' | 'last'; from: VerseAt[]; now: VerseAt[] } | null>(null);
  const pullClick = useRef<{ at: number } | null>(null);
  // When the grip was taken, and when the text was last pressed or keyed: a press made while the grip was held (a second
  // finger) clicks after the lift itself, so that pull waits for no click of its own (Codex review, 01.11).
  const pullStartedAt = useRef(Number.NEGATIVE_INFINITY);
  const textPressedAt = useRef(Number.NEGATIVE_INFINITY);
  const forgetPull = useCallback(() => { pulling.current = null; pullClick.current = null; }, []);
  const clear = useCallback(() => {
    // The hint for choosing a passage goes with that choice: it must not stand over the analysis screen.
    if (purposeRef.current !== 'copy') toast.dismiss(PASSAGE_HINT);
    forgetPull();
    setPicked(null);
    setFormat(null);
    setPurpose('copy');
    setAsParagraph(undefined);
  }, [forgetPull]);
  const actedRef = useRef(onActed);
  actedRef.current = onActed;
  const acted = useCallback((verses: VerseAt[]) => actedRef.current?.(verses), []);
  // Pointer and keyboard doors share the same row snapshot and menu state.
  const openMenu = useCallback((at: VerseAt, row: HTMLElement, pointer?: Pick<VerseMenuAt, 'x' | 'y' | 'touch' | 'held'>) => {
    if (!enabled) return;
    const box = row.getBoundingClientRect();
    const position = pointer ?? { x: box.left + Math.min(24, box.width / 2), y: box.top + Math.min(24, box.height / 2), touch: false, held: false };
    const opener = row.querySelector<HTMLElement>('[data-verse-menu]') ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setMenu({ chapter: at.chapter, verse: at.verse, ...position, opener, row: { top: box.top, left: box.left, width: box.width, height: box.height } });
    acted([{ chapter: at.chapter, verse: at.verse }]);
  }, [acted, enabled]);
  const done = useCallback(() => {
    setMenu(null);
    clear();
  }, [clear]);
  // Another book or Bible, or a tool taken in hand: nothing stays chosen.
  useEffect(done, [bible, bookId, done]);
  useEffect(() => { if (!enabled) done(); }, [enabled, done]);

  const wordsOf = useCallback((at: VerseAt) => {
    const raw = text?.chapters[at.chapter - 1]?.[at.verse - 1];
    return raw ? verseWords(raw) : '';
  }, [text]);
  const chapterLength = useCallback((chapter: number) => text?.chapters[chapter - 1]?.length, [text]);
  const textOf = useCallback(
    (verses: VerseAt[], chosen: CopyFormat) => verseCopyText(verses.map((at) => ({ ...at, words: wordsOf(at) })), chosen, names, chapterLength),
    [chapterLength, names, wordsOf]
  );
  const placeOf = useCallback((verses: VerseAt[]) => copiedPlace(names.book, verses), [names.book]);
  /** The verse as the interface names it, for its menu. */
  const labelOf = useCallback((at: VerseAt) => `${getLocalizedAbbrev(bookId, locale)} ${at.chapter}:${at.verse}`, [bookId, locale]);

  // Expose the reader capability; each row owns space for its visible keyboard button.
  const ribbonMenu = useMemo<RibbonVerseMenu>(() => ({
    enabled,
    label: (chapter, verse) => t('bible.copy.menu', { place: labelOf({ chapter, verse }) }),
    open: (chapter, verse, row) => openMenu({ chapter, verse }, row),
  }), [enabled, labelOf, openMenu, t]);

  // The choice as it is now: a copy or a send that answers late lets go only the choice it was made from.
  const pickedRef = useRef(picked);
  pickedRef.current = picked;
  const clearIfStill = useCallback((from: VerseAt[] | null) => {
    if (pickedRef.current === from) clear();
  }, [clear]);

  // The menu goes at the press; the verses chosen stay until the clipboard took them, so a failed copy can be tried
  // again — and a copy still under way never closes a menu opened after it.
  const copy = useCallback(async (verses: VerseAt[], chosen: CopyFormat) => {
    const from = pickedRef.current;
    setMenu(null);
    // The act is the press: a clipboard that answers late must not put these verses after a newer act.
    acted(verses);
    try {
      await copyPlainText(textOf(verses, chosen));
      toast.success(t('bible.copy.copied', { place: placeOf(verses) }));
      clearIfStill(from);
    } catch {
      toast.error(t('bible.copy.failed'));
    }
  }, [acted, clearIfStill, placeOf, t, textOf]);

  // The system's share window must be asked for in the press itself: nothing awaited before it.
  const share = useCallback(async (verses: VerseAt[], chosen: CopyFormat) => {
    const from = pickedRef.current;
    const sending = navigator.share({ text: textOf(verses, chosen) });
    setMenu(null);
    acted(verses);
    try {
      await sending;
      clearIfStill(from);
    } catch (error) {
      if ((error as { name?: string } | null)?.name !== 'AbortError') toast.error(t('bible.copy.shareFailed'));
    }
  }, [acted, clearIfStill, t, textOf]);

  // The choice started on a verse — by a hold, or the menu's «Выбрать несколько» — is an act on it: the verse goes on the
  // trail, as its menu opened did before a hold chose (case 2026-11-06-comment-paragraph). How to add more is said in the
  // bar, under the place, while one verse is chosen (`byTouch` picks the words): a toast said it at every hold, over the
  // phone's header and the verse just chosen, and stayed over the window opened from the bar (visual pass, 2026-11-07).
  const [byTouch, setByTouch] = useState(false);
  const startPicking = useCallback((at: VerseAt, touch: boolean) => {
    setMenu(null);
    setPicked([at]);
    setFormat(null);
    setPurpose('copy');
    setAsParagraph(undefined);
    setByTouch(touch);
    acted([{ chapter: at.chapter, verse: at.verse }]);
  }, [acted]);
  const limitRef = useRef(limitComment);
  limitRef.current = limitComment;
  // What the comment whose verses are chosen is, as its window says now — handed to the paragraphs' rule, which is a
  // paragraph's alone (`useCommentLimit`): a new comment stretched over a paragraph took that paragraph whole, a written one
  // switched to a paragraph kept none (Codex review of the visual pass, 2026-11-07).
  const commentKindRef = useRef<boolean | undefined>(undefined);
  /**
   * Verses for an analysis or a comment, starting with this one (the verse menu's «Разобрать отрывок», «Комментарий»), or
   * all of an analysis's or a comment's own to change its ends.
   */
  const startPassage = useCallback((at: VerseAt, to?: VerseAt, forWhat: PassagePurpose = 'analysis', asParagraph?: boolean) => {
    forgetPull();
    commentKindRef.current = asParagraph;
    setAsParagraph(forWhat === 'comment' ? asParagraph : undefined);
    setMenu(null);
    setPicked(to && text ? versesBetween(text, at, to) : [at]);
    setFormat(null);
    setPurpose(forWhat);
    toast(t(forWhat === 'comment' && asParagraph ? PARAGRAPH_HINT : PASSAGE_HINTS[forWhat]), { id: PASSAGE_HINT });
  }, [forgetPull, t, text]);
  /**
   * A grip let go: the pull goes into the report as one line, and the click the browser may send after the lift is its
   * own; a pull the browser broke off sends none.
   */
  const pullEnded = useCallback((clickMayFollow: boolean) => {
    const pull = pulling.current;
    pulling.current = null;
    if (pull && text) recordPick(text, `pull-${pull.end}`, pull.from, pull.now, Number.POSITIVE_INFINITY);
    pullClick.current = clickMayFollow && textPressedAt.current < pullStartedAt.current ? { at: performance.now() } : null;
  }, [text]);
  /** A grip taken: the pull starts. */
  const pullStarted = useCallback(() => { pullStartedAt.current = performance.now(); }, []);
  /** A new press or a key on the text: no click after it is a pull's. */
  const forgetPullClick = useCallback(() => {
    pullClick.current = null;
    textPressedAt.current = performance.now();
  }, []);
  /**
   * Whether this click is the one a grip's pull sends after the lift: the first click on the text since the pull was let
   * go, before any new press or key there (each ends the wait — `forgetPullClick`); it then presses nothing. Nothing about
   * the click itself is asked: Safari on the owner's iPad sent it 39 ms after the Pencil's lift naming another pointer
   * (technical report, 01.11), and a click a browser makes up need not count its clicks either.
   */
  const takesPullClick = useCallback((onVerse: boolean) => {
    const pending = pullClick.current;
    if (!pending) return false;
    const since = performance.now() - pending.at;
    pullClick.current = null;
    if (since > PULL_CLICK_MS) return false;
    if (onVerse) recordDiagnostic('verse-pick', { source: 'click', result: 'taken-by-pull', elapsedMs: since });
    return true;
  }, []);
  // A passage stays one piece: a press below or above stretches it, an end verse comes off, one in the middle brings the
  // nearer end to it; a comment's keeps the paragraphs' rule too.
  const stretch = useCallback((at: VerseAt, by: 'press' | 'hold') => {
    if (!text) return;
    const before = pickedRef.current ?? [];
    const { verses, end } = stretchPassage(text, before, at);
    const limit = purposeRef.current === 'comment' ? limitRef.current : undefined;
    const kept = limit ? limit(verses, end, before, commentKindRef.current) : { verses };
    if (kept.said) toast(kept.said, { id: PASSAGE_LIMIT });
    recordPick(text, by, before, kept.verses, pullClick.current ? performance.now() - pullClick.current.at : Number.POSITIVE_INFINITY);
    setPicked(kept.verses);
  }, [text]);
  /** A grip on the chosen run pulled to a verse, or moved by an arrow: that end moves, the passage's rule kept. */
  const moveEnd = useCallback((end: 'first' | 'last', at: VerseAt, by: 'pull' | 'arrow' = 'pull') => {
    const before = pickedRef.current ?? [];
    if (!text || !before.length) return;
    const verses = pulledEnd(text, before, end, at);
    const limit = purposeRef.current === 'comment' ? limitRef.current : undefined;
    const kept = limit ? limit(verses, end, before, commentKindRef.current) : { verses };
    if (kept.said) toast(kept.said, { id: PASSAGE_LIMIT });
    // A pull goes into the report once, when it is let go; an arrow at once.
    if (by === 'pull') pulling.current = { end, from: pulling.current?.from ?? before, now: kept.verses };
    else recordPick(text, `${by}-${end}`, before, kept.verses, Number.POSITIVE_INFINITY);
    setPicked(kept.verses);
  }, [text]);
  const toggle = useCallback((at: VerseAt) => {
    if (purpose !== 'copy') { stretch(at, 'press'); return; }
    setPicked((now) => {
      const rest = (now ?? []).filter((verse) => verseKey(verse) !== verseKey(at));
      const next = rest.length === (now ?? []).length ? [...rest, at] : rest;
      return next.length ? next : null;
    });
  }, [purpose, stretch]);
  /** From the chosen verse nearest to this one, to this one: a passage. */
  const rangeTo = useCallback((at: VerseAt) => {
    if (purpose !== 'copy') { stretch(at, 'hold'); return; }
    setPicked((now) => {
      const chosen = now ?? [];
      if (!chosen.length || !text) return [at];
      const target = bookIndex(text, at);
      const near = chosen.reduce((best, verse) => (Math.abs(bookIndex(text, verse) - target) < Math.abs(bookIndex(text, best) - target) ? verse : best), chosen[0]);
      const added = bookIndex(text, near) < target ? versesBetween(text, near, at) : versesBetween(text, at, near);
      const keys = new Set(chosen.map(verseKey));
      return [...chosen, ...added.filter((verse) => !keys.has(verseKey(verse)))];
    });
  }, [purpose, stretch, text]);
  /** How many links the verse's menu offers: null — the verse has none. */
  const linksOf = useCallback((at: VerseAt) => {
    const count = crossRefs?.counts.get(verseKey(at));
    if (!crossRefs || !count || count.total === 0) return null;
    return crossRefs.mode === 'all' ? count.total : count.main;
  }, [crossRefs]);
  const openLinks = useCallback((at: VerseAt) => {
    setMenu(null);
    crossRefs?.onOpen(at.chapter, at.verse);
  }, [crossRefs]);

  // The lights on the rows: the verses chosen, and the one held or whose menu is open.
  const heldAt = held ?? menu;
  useEffect(() => {
    setOnRows(textRef.current, VERSE_CHOSEN_ATTRIBUTE, new Set((picked ?? []).map(verseKey)));
  }, [picked, drawn, text, textRef]);
  useEffect(() => {
    setOnRows(textRef.current, VERSE_HELD_ATTRIBUTE, new Set(heldAt ? [verseKey(heldAt)] : []));
  }, [heldAt, drawn, text, textRef]);

  // Match menu accessibility state without redrawing the book for each menu action.
  useEffect(() => {
    for (const button of textRef.current?.querySelectorAll('[data-verse-menu]') ?? []) {
      const row = button.closest('[data-verse]');
      button.setAttribute('aria-expanded', String(Boolean(menu && row?.getAttribute('data-verse') === verseKey(menu))));
    }
  }, [menu, drawn, text, textRef]);

  // Escape lets the choice go, unless a window above it takes the key.
  const choosing = picked !== null;
  useEffect(() => {
    if (!choosing) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !hasOpenLayer()) clear();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [choosing, clear]);

  // A selection copied by the system (⌘C, Ctrl+C, the browser's Copy): the words without the numbers and chips
  // drawn among them, with the place and the Bible.
  const copyRef = useRef({ names, chapterLength, t });
  copyRef.current = { names, chapterLength, t };
  useEffect(() => {
    const onCopy = (event: ClipboardEvent) => {
      const root = textRef.current;
      const selection = window.getSelection();
      if (!root || !event.clipboardData || event.defaultPrevented || !selection || selection.isCollapsed || selection.rangeCount === 0) return;
      // A field being typed in keeps its own selection apart from the page's (Firefox): its copy is its own.
      if (isTypingIn(document.activeElement)) return;
      const range = selection.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) return;
      const verses = selectedVerses(root, range);
      if (!verses.length) return;
      const now = copyRef.current;
      event.preventDefault();
      event.clipboardData.setData('text/plain', verseCopyText(verses, DEFAULT_COPY_FORMAT, now.names, now.chapterLength));
      toast.success(now.t('bible.copy.copiedWithPlace', { place: copiedPlace(now.names.book, verses) }));
      actedRef.current?.(verses);
    };
    document.addEventListener('copy', onCopy);
    return () => document.removeEventListener('copy', onCopy);
  }, [textRef]);

  return {
    enabled,
    ribbonMenu,
    menu, openMenu, closeMenu: useCallback(() => setMenu(null), []),
    hold: setHeld,
    picked, picking: choosing, byTouch, startPicking, toggle, rangeTo, clear,
    purpose, asParagraph, startPassage, moveEnd, pullStarted, pullEnded, takesPullClick, forgetPullClick, passage: purpose !== 'copy' && picked && text ? pickedPassage(text, picked) : null,
    format: format ?? DEFAULT_COPY_FORMAT, setFormat,
    copy, share, canShare,
    wordsOf, labelOf, placeOf, linksOf, openLinks,
  };
}

export type VerseCopy = ReturnType<typeof useVerseCopy>;
