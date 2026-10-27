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
import { copiedPlace, defaultCopyFormat, verseCopyText, type CopyFormat, type CopyNames } from '@/utils/verseCopy';

import { VERSE_CHOSEN_ATTRIBUTE, VERSE_HELD_ATTRIBUTE, type RibbonCrossRefs } from '../BookRibbon';

import { selectedVerses, verseKey, type VerseAt } from './selectedVerses';

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
export function useCopyNames(bible: BibleId, bookId: string): CopyNames {
  const { t, i18n } = useTranslation();
  const language = BIBLES[bible].language;
  const isInterfaceBible = bibleForLocale(resolveAppLocale(i18n.language)) === bible;
  return useMemo(
    () => (isInterfaceBible
      ? { book: getLocalizedAbbrev(bookId, language) }
      : { book: getLocalizedAbbrev(bookId, language), mark: t(`bible.translations.${bible}.short`) }),
    [bible, bookId, isInterfaceBible, language, t]
  );
}

const subscribeNever = () => () => undefined;
const isTypingIn = (element: Element | null) =>
  element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || (element instanceof HTMLElement && element.isContentEditable);
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
export function useVerseCopy({ textRef, text, bible, bookId, drawn, crossRefs, enabled }: {
  textRef: RefObject<HTMLElement | null>;
  text: BookText | null;
  bible: BibleId;
  bookId: string;
  /** The chapters drawn of a big book: rows come and go, and their lights are set again. */
  drawn?: unknown;
  crossRefs?: RibbonCrossRefs;
  /** Off while a mark tool is in hand: a press then paints. */
  enabled: boolean;
}) {
  const { t, i18n } = useTranslation();
  const locale = resolveAppLocale(i18n.language);
  const names = useCopyNames(bible, bookId);
  const canShare = useSyncExternalStore(subscribeNever, canShareNow, () => false);
  const [menu, setMenu] = useState<VerseMenuAt | null>(null);
  const [picked, setPicked] = useState<VerseAt[] | null>(null);
  const [format, setFormat] = useState<CopyFormat | null>(null);
  const [held, setHeld] = useState<VerseAt | null>(null);

  const clear = useCallback(() => {
    setPicked(null);
    setFormat(null);
  }, []);
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
    try {
      await copyPlainText(textOf(verses, chosen));
      toast.success(t('bible.copy.copied', { place: placeOf(verses) }));
      clearIfStill(from);
    } catch {
      toast.error(t('bible.copy.failed'));
    }
  }, [clearIfStill, placeOf, t, textOf]);

  // The system's share window must be asked for in the press itself: nothing awaited before it.
  const share = useCallback(async (verses: VerseAt[], chosen: CopyFormat) => {
    const from = pickedRef.current;
    const sending = navigator.share({ text: textOf(verses, chosen) });
    setMenu(null);
    try {
      await sending;
      clearIfStill(from);
    } catch (error) {
      if ((error as { name?: string } | null)?.name !== 'AbortError') toast.error(t('bible.copy.shareFailed'));
    }
  }, [clearIfStill, t, textOf]);

  const startPicking = useCallback((at: VerseAt, touch: boolean) => {
    setMenu(null);
    setPicked([at]);
    setFormat(null);
    toast(t(touch ? 'bible.copy.severalHint' : 'bible.copy.severalHintMouse'));
  }, [t]);
  const toggle = useCallback((at: VerseAt) => setPicked((now) => {
    const rest = (now ?? []).filter((verse) => verseKey(verse) !== verseKey(at));
    const next = rest.length === (now ?? []).length ? [...rest, at] : rest;
    return next.length ? next : null;
  }), []);
  /** From the chosen verse nearest to this one, to this one: a passage. */
  const rangeTo = useCallback((at: VerseAt) => setPicked((now) => {
    const chosen = now ?? [];
    if (!chosen.length || !text) return [at];
    const index = (verse: VerseAt) => text.chapters.slice(0, verse.chapter - 1).reduce((sum, chapter) => sum + chapter.length, 0) + verse.verse - 1;
    const target = index(at);
    const near = chosen.reduce((best, verse) => (Math.abs(index(verse) - target) < Math.abs(index(best) - target) ? verse : best), chosen[0]);
    const [from, to] = index(near) < target ? [near, at] : [at, near];
    const added: VerseAt[] = [];
    for (let chapter = from.chapter; chapter <= to.chapter; chapter += 1) {
      const first = chapter === from.chapter ? from.verse : 1;
      const last = chapter === to.chapter ? to.verse : text.chapters[chapter - 1].length;
      for (let verse = first; verse <= last; verse += 1) added.push({ chapter, verse });
    }
    const keys = new Set(chosen.map(verseKey));
    return [...chosen, ...added.filter((verse) => !keys.has(verseKey(verse)))];
  }), [text]);
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
      event.clipboardData.setData('text/plain', verseCopyText(verses, defaultCopyFormat(verses.length), now.names, now.chapterLength));
      toast.success(now.t('bible.copy.copiedWithPlace', { place: copiedPlace(now.names.book, verses) }));
    };
    document.addEventListener('copy', onCopy);
    return () => document.removeEventListener('copy', onCopy);
  }, [textRef]);

  return {
    enabled,
    menu, openMenu: setMenu, closeMenu: useCallback(() => setMenu(null), []),
    hold: setHeld,
    picked, picking: choosing, startPicking, toggle, rangeTo, clear,
    format: format ?? defaultCopyFormat(picked?.length ?? 1), setFormat,
    copy, share, canShare,
    wordsOf, labelOf, placeOf, linksOf, openLinks,
  };
}

export type VerseCopy = ReturnType<typeof useVerseCopy>;
