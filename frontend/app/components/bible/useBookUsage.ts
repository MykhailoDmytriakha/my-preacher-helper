'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDataCollection } from '@/data-engine/react.client';
import { useResolvedUid } from '@/hooks/useResolvedUid';
import { getLocalizedAbbrev } from '@/utils/bibleBooks';
import { SCRIPTURE_USAGE_KINDS, bookUsage, passageCovers, usageDocuments, type BookUsageEntry, type ScriptureUsageKind } from '@/utils/scriptureUsage';
import { verseCount } from '@/utils/versification';

import { useMinePrefs } from './minePrefs';
import { USAGE_KIND_LOOK } from './usageKinds';

import type { AnalysedVerse, MineBadge, RibbonMine } from './BookRibbon';
import type { TextComment } from './CommentsOnText';
import type { MinimapMark } from './minimapLayout';
import type { Group, Sermon, ServiceOrder, StudyNote } from '@/models/models';
import type { AppLocale } from '@/utils/appLocale';
import type { BibleId } from '@/utils/bibles';
import type { Passage } from '@/utils/scriptureReferenceNumbering';

/**
 * A verse whose list is open, or a whole chapter's (`verse` null). `stretch` — opened from an analysis's badge: the list is
 * that badge's, named by its passage (the owner, 30.10: «тут нужно ссылку поправить, текст сплошной не нужно дублировать»).
 */
export type MinePlace = { chapter: number; verse: number | null; stretch?: MineStretch };
/** A badge's kind and passage: what an analysis's badge opens. */
export type MineStretch = { kind: ScriptureUsageKind; passage: Passage };

const samePassage = (a: Passage, b: Passage) => a.chapter === b.chapter && a.fromVerse === b.fromVerse && a.toChapter === b.toChapter && a.toVerse === b.toVerse;

type CollectionState = ReturnType<typeof useDataCollection>['state'];

/** The person's own documents of a list: the ones being deleted on this device are already gone for them. */
function owned<T>(state: CollectionState, uid: string | undefined): T[] {
  return (state?.documents ?? []).flatMap((row) => (row.value && !row.deleting && row.value.userId === uid ? [{ ...row.value, id: row.resource.id } as T] : []));
}

/** The verses a badge after a verse names: "12", "9–11", "19–10:4"; a whole chapter's badge names none. */
export function stretchLabel(passage: Passage): string {
  if (passage.fromVerse === undefined) return '';
  const to = passage.toVerse ?? passage.fromVerse;
  if (passage.toChapter !== passage.chapter) return `${passage.fromVerse}–${passage.toChapter}:${to}`;
  return to === passage.fromVerse ? String(passage.fromVerse) : `${passage.fromVerse}–${to}`;
}

/**
 * The words on a badge — always the place with its chapter (the owner, 2026-10-21): "3:16", "3:16–18",
 * "3:16–4:18", and a whole chapter from its first verse to its last as this Bible numbers it, "3:1–36".
 */
export function badgeLabel(passage: Passage, bible: BibleId, bookId: string): string {
  const from = passage.fromVerse ?? 1;
  const last = passage.fromVerse === undefined ? verseCount(bible, bookId, passage.toChapter) : (passage.toVerse ?? passage.fromVerse);
  if (!last) return String(passage.chapter);
  if (passage.toChapter !== passage.chapter) return `${passage.chapter}:${from}–${passage.toChapter}:${last}`;
  return last === from ? `${passage.chapter}:${from}` : `${passage.chapter}:${from}–${last}`;
}

/** The place of a passage in words: "Евр 4:9–11", "Евр 4", "Пс 9–10". */
export function passageLabel(abbrev: string, passage: Passage): string {
  if (passage.fromVerse !== undefined) return `${abbrev} ${passage.chapter}:${stretchLabel(passage)}`;
  return passage.toChapter !== passage.chapter ? `${abbrev} ${passage.chapter}–${passage.toChapter}` : `${abbrev} ${passage.chapter}`;
}

const wholeChapterOf = (entry: BookUsageEntry, chapter: number) =>
  entry.passage.fromVerse === undefined && entry.passage.chapter <= chapter && chapter <= entry.passage.toChapter;

/** Each document once: a note naming chapters 1-2 and 2-3 is one row at chapter 2, not two. */
const onceEach = (entries: BookUsageEntry[]) => entries.filter((entry, index) => entries.findIndex((other) => other.kind === entry.kind && other.id === entry.id) === index);

/** The entries a verse's list shows (`verse` set) and those that name its whole chapter. */
export function entriesAt(entries: readonly BookUsageEntry[], place: MinePlace): { onVerse: BookUsageEntry[]; wholeChapter: BookUsageEntry[] } {
  const { chapter, verse, stretch } = place;
  // An analysis's badge opened: what stands behind that badge, the documents of its kind on its passage.
  if (stretch) return { onVerse: onceEach(entries.filter((entry) => entry.kind === stretch.kind && samePassage(entry.passage, stretch.passage))), wholeChapter: [] };
  const onVerse = verse === null ? [] : onceEach(entries.filter((entry) => entry.passage.fromVerse !== undefined && passageCovers(entry.passage, chapter, verse)));
  // A document already listed on the verse is not listed again under its chapter (Codex review, round 2).
  const listed = (entry: BookUsageEntry) => onVerse.some((other) => other.kind === entry.kind && other.id === entry.id);
  return { onVerse, wholeChapter: onceEach(entries.filter((entry) => wholeChapterOf(entry, chapter) && !listed(entry))) };
}

/**
 * The verses of the person's passage analyses in this Bible, for the bar beside them in the reader (the owner, 2026-10-29:
 * «откуда до куда идёт разбор»). Analyses that overlap make one bar; two that only touch keep a break between them.
 */
export function analysedVerses(entries: readonly BookUsageEntry[], bible: BibleId, bookId: string): Map<string, AnalysedVerse> {
  const verses = new Map<string, AnalysedVerse>();
  entries.forEach(({ kind, passage }) => {
    if (kind !== 'analysis' || passage.fromVerse === undefined) return;
    const last = passage.toVerse ?? passage.fromVerse;
    for (let chapter = passage.chapter; chapter <= passage.toChapter; chapter++) {
      const from = chapter === passage.chapter ? passage.fromVerse : 1;
      const to = chapter === passage.toChapter ? last : verseCount(bible, bookId, chapter);
      for (let verse = from; verse <= to; verse++) {
        const key = `${chapter}:${verse}`;
        const top = chapter === passage.chapter && verse === passage.fromVerse;
        const bottom = chapter === passage.toChapter && verse === last;
        const known = verses.get(key);
        // Inside one analysis the bar runs on, even where another one starts or ends.
        verses.set(key, known ? { top: known.top && top, bottom: known.bottom && bottom } : { top, bottom });
      }
    }
  });
  return verses;
}

/**
 * EVERYTHING OF THE PERSON'S IN THE BOOK BEING READ (case 2026-10-12-block-diagram, 2.2): their notes,
 * sermons, groups and service orders, read from the engine's lists, put on the verses they name in the
 * Bible being read (`bookUsage`). Nothing is stored: the book gathers what points at it each time.
 * Kept by value — the lists come anew with each step of a sync, and a new value each time would redraw
 * the whole book's ribbon. The library is first read only once the text shows (`ready`): reading 420
 * documents the first time takes about 0.4 s (measured 2026-10-21; each one is then kept until it
 * changes), and the text shows first instead of waiting for it. Comments (a study note's short kind) stand as
 * their own grey words under the verse or the chapter heading, or as badges, as the person chose in Settings.
 */
export function useBookUsage(bookId: string, bible: BibleId, locale: AppLocale, ready: boolean, onEditComment?: (id: string) => void) {
  const { t } = useTranslation();
  const { uid } = useResolvedUid();
  const { show, comments: commentsShown } = useMinePrefs();
  // Switched off, the lists are not even watched: the setting saves the work, not only the badges.
  const watched = (collection: string) => (uid && show ? collection : null);
  const notes = useDataCollection(watched('studyNotes'));
  const sermons = useDataCollection(watched('sermons'));
  const groups = useDataCollection(watched('groups'));
  const orders = useDataCollection(watched('serviceOrders'));
  // Read after the text's own render, in React's next pass, not inside it. A timer did the same and, set under a
  // test's fake clock, kept the next tests' books from showing.
  const armed = useDeferredValue(ready);

  const documents = useMemo(() => (!armed || !show ? [] : usageDocuments({
    locale,
    notes: owned<StudyNote>(notes.state, uid),
    sermons: owned<Sermon>(sermons.state, uid),
    groups: owned<Group>(groups.state, uid),
    serviceOrders: owned<ServiceOrder>(orders.state, uid),
  })), [armed, show, locale, uid, notes.state, sermons.state, groups.state, orders.state]);
  const entriesKey = useMemo(() => JSON.stringify(bookUsage(documents, bookId, bible)), [documents, bookId, bible]);
  const entries = useMemo(() => JSON.parse(entriesKey) as BookUsageEntry[], [entriesKey]);
  const shown = show && entries.length > 0;

  const [openAt, setOpenAt] = useState<MinePlace | null>(null);
  const close = useCallback(() => setOpenAt(null), []);
  const onOpen = useCallback((chapter: number, verse: number | null, stretch?: MineStretch) => setOpenAt({ chapter, verse, ...(stretch ? { stretch } : {}) }), []);

  const ribbon = useMemo<RibbonMine | undefined>(() => {
    if (!shown) return undefined;
    const abbrev = getLocalizedAbbrev(bookId, locale);
    // One badge per kind and stretch at a place: two notes on 4:12 are one green badge "12 · 2".
    type Gathered = { kind: ScriptureUsageKind; passage: Passage; titles: Map<string, string> };
    const gather = (into: Map<string | number, Map<string, Gathered>>, at: string | number, entry: BookUsageEntry, passage: Passage) => {
      const badges = into.get(at) ?? new Map<string, Gathered>();
      const id = `${entry.kind}:${stretchLabel(passage)}`;
      const badge = badges.get(id) ?? { kind: entry.kind, passage, titles: new Map<string, string>() };
      // A document once per badge, however many of its passages fall there.
      badge.titles.set(entry.id, entry.title || t('bible.preview.untitled'));
      badges.set(id, badge);
      into.set(at, badges);
    };
    const onVerses = new Map<string | number, Map<string, Gathered>>();
    const onChapters = new Map<string | number, Map<string, Gathered>>();
    // Comments as words: under the verse a comment starts at, under every heading of the chapters it is written to.
    const asText = commentsShown === 'text' && Boolean(onEditComment);
    const textAt = new Map<string, Map<string, TextComment>>();
    const textOnChapters = new Map<number, Map<string, TextComment>>();
    const write = <K,>(into: Map<K, Map<string, TextComment>>, at: K, entry: BookUsageEntry, passage: Passage) => {
      const comments = into.get(at) ?? new Map<string, TextComment>();
      comments.set(entry.id, { id: entry.id, body: entry.body ?? '', editLabel: t('bible.mine.editComment', { place: passageLabel(abbrev, passage) }) });
      into.set(at, comments);
    };
    entries.forEach((entry) => {
      const { passage } = entry;
      if (asText && entry.kind === 'comment') {
        if (passage.fromVerse !== undefined) write(textAt, `${passage.chapter}:${passage.fromVerse}`, entry, passage);
        else for (let chapter = passage.chapter; chapter <= passage.toChapter; chapter++) write(textOnChapters, chapter, entry, entry.passage);
        return;
      }
      if (passage.fromVerse !== undefined) gather(onVerses, `${passage.chapter}:${passage.fromVerse}`, entry, passage);
      // By a chapter's heading the badge speaks of that chapter: "2:1–23", whatever range the document names.
      else for (let chapter = passage.chapter; chapter <= passage.toChapter; chapter++) gather(onChapters, chapter, entry, { chapter, toChapter: chapter });
    });
    const toBadges = (badges: Map<string, Gathered>): MineBadge[] => [...badges.values()].map((badge) => ({
      kind: badge.kind,
      ...(badge.kind === 'analysis' ? { opens: { kind: badge.kind, passage: badge.passage } } : {}),
      label: badgeLabel(badge.passage, bible, bookId),
      count: badge.titles.size,
      // The number on the corner is only seen: a screen reader hears it here (Codex review, round 3).
      ariaLabel: t(badge.titles.size > 1 ? 'bible.mine.badgeLabelMany' : 'bible.mine.badgeLabel', {
        kind: t(USAGE_KIND_LOOK[badge.kind].wordKey), place: passageLabel(abbrev, badge.passage), titles: [...badge.titles.values()].join(' · '), count: badge.titles.size,
      }),
    }));
    const analysed = analysedVerses(entries, bible, bookId);
    return {
      at: new Map([...onVerses].map(([at, badges]) => [String(at), toBadges(badges)])),
      chapters: new Map([...onChapters].map(([at, badges]) => [Number(at), toBadges(badges)])),
      onOpen,
      moreLabel: (count) => t('bible.mine.moreLabel', { count }),
      ...(analysed.size ? { analysed } : {}),
      ...(asText && onEditComment ? { comments: {
        at: new Map([...textAt].map(([at, comments]) => [at, [...comments.values()]])),
        chapters: new Map([...textOnChapters].map(([at, comments]) => [at, [...comments.values()]])),
        onEdit: onEditComment,
      } } : {}),
    };
  }, [shown, entries, bookId, bible, locale, onOpen, t, commentsShown, onEditComment]);

  /** The marks on the minimap's right edge: one place each (a passage's first verse, a whole chapter's label), its kinds in the order of the badges. */
  const mapMarks = useMemo<readonly MinimapMark<ScriptureUsageKind>[] | undefined>(() => {
    if (!shown) return undefined;
    const marks = new Map<string, { chapter: number; verse: number | null; kinds: ScriptureUsageKind[] }>();
    const add = (chapter: number, verse: number | null, kind: ScriptureUsageKind) => {
      const key = `${chapter}:${verse ?? ''}`;
      const mark = marks.get(key) ?? { chapter, verse, kinds: [] };
      if (!mark.kinds.includes(kind)) mark.kinds.push(kind);
      marks.set(key, mark);
    };
    entries.forEach(({ kind, passage }) => {
      if (passage.fromVerse !== undefined) add(passage.chapter, passage.fromVerse, kind);
      // Whole chapters mark each of them, as each has its heading badge: Ruth 1-3 is three marks (Codex review, round 3).
      else for (let chapter = passage.chapter; chapter <= passage.toChapter; chapter++) add(chapter, null, kind);
    });
    marks.forEach((mark) => mark.kinds.sort((a, b) => SCRIPTURE_USAGE_KINDS.indexOf(a) - SCRIPTURE_USAGE_KINDS.indexOf(b)));
    return [...marks.values()];
  }, [shown, entries]);

  const listed = useMemo(() => (openAt ? entriesAt(entries, openAt) : null), [entries, openAt]);
  const emptied = Boolean(listed && !listed.onVerse.length && !listed.wholeChapter.length);
  // Switched off, or nothing left there (deleted on another device): the window goes, and switching back on does not bring it back.
  useEffect(() => {
    if (openAt && (!shown || emptied)) setOpenAt(null);
  }, [openAt, shown, emptied]);
  const open = shown && !emptied ? openAt : null;
  // Where a comment stands, for its window's title; and which comment a door opens — the one written to this verse
  // (starting there) or to this whole chapter. Nothing there: the door writes a new one.
  const commentPassage = useCallback((id: string) => entries.find((entry) => entry.kind === 'comment' && entry.id === id)?.passage, [entries]);
  const commentOn = useCallback((chapter: number, verse: number | null) => entries.find((entry) => entry.kind === 'comment' && (verse === null
    ? wholeChapterOf(entry, chapter)
    : entry.passage.chapter === chapter && entry.passage.fromVerse === verse))?.id, [entries]);
  // A door may open only once ALL the comments are known — the whole list read, no failure, not a copy for reading: on a
  // part of it, a comment missing there would be taken for none and a second written (Codex review, 2026-10-28; the same
  // rule as a mark's creation, `marks/markStore.ts`). Meanwhile a written comment still opens from its own words.
  // Switched off, the material and its doors are gone — «only the text remains».
  const commentsReady = show && armed && notes.state?.complete === true && !notes.error && !notes.readOnly;
  return { ribbon, mapMarks, openAt: open, listed: open ? listed : null, close, commentPassage, commentOn, commentsReady };
}
