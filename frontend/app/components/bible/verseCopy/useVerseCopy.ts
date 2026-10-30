'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';


import { hasOpenLayer } from '@/hooks/useModalLayer';
import { resolveAppLocale } from '@/utils/appLocale';
import { getLocalizedAbbrev } from '@/utils/bibleBooks';
import { BIBLES, bibleForLocale, type BibleId } from '@/utils/bibles';
import { verseWords, type BookText } from '@/utils/bibleText';
import { copyPlainText } from '@/utils/clipboard';
import { isTypingIn } from '@/utils/typingTarget';
import { copiedPlace, DEFAULT_COPY_FORMAT, verseCopyText, type CopyFormat, type CopyNames } from '@/utils/verseCopy';

import { VERSE_CHOSEN_ATTRIBUTE, VERSE_HELD_ATTRIBUTE, type RibbonCrossRefs } from '../BookRibbon';

import { bookIndex, pickedPassage, stretchPassage, versesBetween } from './passagePick';
import { selectedVerses, verseKey, type VerseAt } from './selectedVerses';

import type { TFunction } from 'i18next';

/**
 * Where the verse's menu was asked for: the press, the row as it stood, whether a finger asked, and whether a hold
 * opened it — the click that ends a hold may land on the menu.
 */
export type VerseMenuAt = VerseAt & { x: number; y: number; touch: boolean; held: boolean; row: { top: number; left: number; width: number; height: number } };

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
  const { t, i18n } = useTranslation();
  return useMemo(() => copyNamesOf(bible, bookId, i18n.language, t), [bible, bookId, i18n.language, t]);
}

const subscribeNever = () => () => undefined;
const PASSAGE_HINT = 'analysis-passage-hint';
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
export function useVerseCopy({ textRef, text, bible, bookId, drawn, crossRefs, enabled, onActed }: {
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
}) {
  const { t, i18n } = useTranslation();
  const locale = resolveAppLocale(i18n.language);
  const names = useCopyNames(bible, bookId);
  const canShare = useSyncExternalStore(subscribeNever, canShareNow, () => false);
  const [menu, setMenu] = useState<VerseMenuAt | null>(null);
  const [picked, setPicked] = useState<VerseAt[] | null>(null);
  // What the verses are chosen for: a copy, or a passage to analyse — one running piece of text (case
  // 2026-10-12-block-diagram, 3.4). One choosing for both, so the rows' lights and the presses are the same.
  const [purpose, setPurpose] = useState<'copy' | 'analysis'>('copy');
  const [format, setFormat] = useState<CopyFormat | null>(null);
  const [held, setHeld] = useState<VerseAt | null>(null);

  const purposeRef = useRef(purpose);
  purposeRef.current = purpose;
  const clear = useCallback(() => {
    // The hint for choosing a passage goes with that choice: it must not stand over the analysis screen.
    if (purposeRef.current === 'analysis') toast.dismiss(PASSAGE_HINT);
    setPicked(null);
    setFormat(null);
    setPurpose('copy');
  }, []);
  const actedRef = useRef(onActed);
  actedRef.current = onActed;
  const acted = useCallback((verses: VerseAt[]) => actedRef.current?.(verses), []);
  const openMenu = useCallback((at: VerseMenuAt) => {
    setMenu(at);
    acted([{ chapter: at.chapter, verse: at.verse }]);
  }, [acted]);
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

  const startPicking = useCallback((at: VerseAt, touch: boolean) => {
    setMenu(null);
    setPicked([at]);
    setFormat(null);
    setPurpose('copy');
    toast(t(touch ? 'bible.copy.severalHint' : 'bible.copy.severalHintMouse'));
  }, [t]);
  /** Verses for an analysis, starting with this one (the verse menu's «Разобрать отрывок»), or all of an analysis's own to change its ends. */
  const startPassage = useCallback((at: VerseAt, to?: VerseAt) => {
    setMenu(null);
    setPicked(to && text ? versesBetween(text, at, to) : [at]);
    setFormat(null);
    setPurpose('analysis');
    toast(t('analysis.pick.hint'), { id: PASSAGE_HINT });
  }, [t, text]);
  // A passage for an analysis stays one piece: a press below or above stretches it, an end verse comes off.
  const stretch = useCallback((at: VerseAt) => {
    if (!text) return;
    const { verses, inside } = stretchPassage(text, pickedRef.current ?? [], at);
    if (inside) toast(t('analysis.pick.inside'));
    setPicked(verses);
  }, [t, text]);
  const toggle = useCallback((at: VerseAt) => {
    if (purpose === 'analysis') { stretch(at); return; }
    setPicked((now) => {
      const rest = (now ?? []).filter((verse) => verseKey(verse) !== verseKey(at));
      const next = rest.length === (now ?? []).length ? [...rest, at] : rest;
      return next.length ? next : null;
    });
  }, [purpose, stretch]);
  /** From the chosen verse nearest to this one, to this one: a passage. */
  const rangeTo = useCallback((at: VerseAt) => {
    if (purpose === 'analysis') { stretch(at); return; }
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
    menu, openMenu, closeMenu: useCallback(() => setMenu(null), []),
    hold: setHeld,
    picked, picking: choosing, startPicking, toggle, rangeTo, clear,
    purpose, startPassage, passage: purpose === 'analysis' && picked && text ? pickedPassage(text, picked) : null,
    format: format ?? DEFAULT_COPY_FORMAT, setFormat,
    copy, share, canShare,
    wordsOf, labelOf, placeOf, linksOf, openLinks,
  };
}

export type VerseCopy = ReturnType<typeof useVerseCopy>;
