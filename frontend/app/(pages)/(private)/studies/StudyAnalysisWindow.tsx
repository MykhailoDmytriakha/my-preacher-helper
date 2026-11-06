'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { analysisPassageHref, forgetListArrival, leaveAnalysisAddress, readAnalysisAddress, readListArrival } from '@/components/bible/analysis/analysisAddress';
import { AnalysisEditor } from '@/components/bible/analysis/AnalysisEditor';
import { useAnalysisBookMarks } from '@/components/bible/analysis/useAnalysisBookMarks';
import { BibleIcon } from '@/components/bible/BibleIcon';
import { AnalysisIcon } from '@/components/Icons';
import { useWayInOnce } from '@/hooks/useWayInOnce';
import { resolveAppLocale } from '@/utils/appLocale';
import { bibleForLocale, isBibleId, type BibleId } from '@/utils/bibles';
import { fetchBookText, type BookText } from '@/utils/bibleText';

import type { StudyNote } from '@/models/models';

/** A book that has not come by then is said to be on its way. */
const BOOK_SLOW_MS = 500;

/** The Bible an analysis was made on: its words are counted in that text and are laid on no other. */
export function analysisBible(note: Pick<StudyNote, 'analysis' | 'scriptureRefs'>, fallback: BibleId): BibleId {
  const own = note.analysis?.bible ?? note.scriptureRefs[0]?.bible;
  return isBibleId(own) ? own : fallback;
}

/**
 * A PASSAGE'S ANALYSIS OPENED IN STUDIES (the owner, 02.11: «Изучение, вкладка „Разборы“… открывается буквально этот
 * текст, в котором ты можешь делать правку или смотреть»): the Bible's own analysis screen (`AnalysisEditor`), over the
 * list, on the text of the analysis's own Bible — never the reader's choice of another one, which would lay its parts on
 * other words (BUG-20261030-analysis-other-bible-overwrite) — with the book's marks. Closed, the list stands as it was.
 * Its verses are changed in the Bible, where they are chosen on the text, so this screen offers no «Изменить стихи».
 * Its door «В Библии» leads to its passage there, lit, and the reader's way back — and Back — return to it open over the
 * list (the owner, 03.11: «был в изучении и открыл разбор, я хочу перейти к Библии»).
 * A book that cannot be read (no connection and not kept on the device) is said, and nothing opens; one that takes more
 * than a moment to come says it is being read, with Cancel, or the press looks like it did nothing (Codex UX, 04.11). One
 * kept on the device opens at once, and nothing is said.
 */
export function StudyAnalysisWindow({ note, editing, onClose }: { note: StudyNote; editing: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const locale = resolveAppLocale(i18n.language);
  const bookId = note.scriptureRefs[0]?.book ?? '';
  const bible = analysisBible(note, bibleForLocale(locale));
  const [text, setText] = useState<BookText | null>(null);
  // The book is read for the analysis's Bible and book only: a new close or a new language's words do not read it again.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const tRef = useRef(t);
  tRef.current = t;
  useEffect(() => {
    let alive = true;
    setText(null);
    const waiting = `analysis-book-${note.id}`;
    // Said with its Cancel: the person may turn to something else rather than wait (Codex, 04.11).
    const slow = window.setTimeout(() => toast.loading(tRef.current('bible.loading'), {
      id: waiting,
      action: { label: tRef.current('common.cancel'), onClick: () => closeRef.current() },
    }), BOOK_SLOW_MS);
    const settle = () => { window.clearTimeout(slow); toast.dismiss(waiting); };
    fetchBookText(bookId, bible).then(
      (book) => {
        settle();
        if (alive) setText(book);
      },
      () => {
        settle();
        if (!alive) return;
        toast.error(tRef.current('bible.loadError'));
        closeRef.current();
      },
    );
    return () => { alive = false; settle(); };
  }, [bible, bookId, note.id]);
  const marks = useAnalysisBookMarks({ bible, bookId, text });
  if (!text) return null;
  return (
    <AnalysisEditor
      opening={{ kind: 'open', id: note.id, editing }}
      text={text}
      bookId={bookId}
      bible={bible}
      locale={locale}
      marks={marks.source}
      marksStatus={marks.status}
      onClose={onClose}
      backLabel={t('analysis.backToList')}
      // The way back from the passage is the address as it stands at the press: this analysis, in its mode.
      door={{ home: 'bible', href: () => analysisPassageHref(note, { locale, from: `${window.location.pathname}${window.location.search}` }) }}
      onOpenScreen={(href) => router.push(href)}
    />
  );
}

/**
 * Which analysis Studies has open over its list, if any. The screen keeps `analysis=` in the address
 * (`analysisAddress.ts`), so a reload opens the same one again, in the mode it was in — when the list this device holds
 * has it. One it does not hold (made on another device and not here yet, or deleted) is said, and the address forgets
 * it: it is never opened later over whatever the person has turned to meanwhile (Codex, 02.11, two rounds on waiting
 * for it); the person opens it from the list once it is there. Closed, it leaves the address too — its step in history
 * taken back (`useAnalysisAddress`) — and Forward to that step opens it again.
 */
export function useStudyAnalysisOpening(notes: readonly StudyNote[], loading: boolean) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<{ id: string; editing: boolean } | null>(null);
  const note = open ? notes.find((entry) => entry.id === open.id && entry.type === 'analysis') : undefined;
  const holds = useCallback((id: string) => notes.some((entry) => entry.id === id && entry.type === 'analysis'), [notes]);
  const addressRead = useRef(false);
  useEffect(() => {
    if (addressRead.current || loading) return;
    addressRead.current = true;
    const named = readAnalysisAddress();
    if (!named) return;
    if (holds(named.id)) {
      setOpen({ id: named.id, editing: named.mode === 'edit' });
      return;
    }
    leaveAnalysisAddress(named.id);
    toast(t('studiesWorkspace.analysisNotHere'));
  }, [holds, loading, t]);
  // Wherever the browser moves — Back, Forward, a jump from its list of history — what stands open is the analysis the
  // entry names, in its mode, if this device holds it, and nothing otherwise (Codex, 04.11, four rounds). Where it landed
  // is read at once, before anything mounting meanwhile writes the address again. What the entry does not name closes at
  // once — a screen still waiting for its book too, which has no ear for Back yet; what it names opens once the screen left
  // has closed itself.
  const holdsNow = useRef(holds);
  holdsNow.current = holds;
  useEffect(() => {
    let after: ReturnType<typeof setTimeout> | undefined;
    const moved = () => {
      clearTimeout(after);
      const named = readAnalysisAddress();
      const landed = named && holdsNow.current(named.id) ? { id: named.id, editing: named.mode === 'edit' } : null;
      setOpen((was) => (was && landed && was.id === landed.id && was.editing === landed.editing ? was : null));
      if (landed) after = setTimeout(() => setOpen((was) => was ?? landed), 0);
    };
    window.addEventListener('popstate', moved);
    return () => { window.removeEventListener('popstate', moved); clearTimeout(after); };
  }, []);
  const openAnalysis = useCallback((target: StudyNote, editing: boolean) => setOpen({ id: target.id, editing }), []);
  const close = useCallback(() => {
    leaveAnalysisAddress(open?.id ?? null);
    setOpen(null);
  }, [open?.id]);
  return { opened: note && open ? { note, editing: open.editing } : null, open: openAnalysis, close };
}

/** How long the card the list was opened at stays lit. */
const LIT_MS = 2200;
/** How long the list waits for the analysis it was opened at to come, before it lets it go. */
const ARRIVAL_WAIT_MS = 10_000;

/**
 * The analysis Studies' list was opened at — from the Bible's analysis screen, its door «Все разборы» (the owner, 03.11) —
 * a way in, taken once (`useWayInOnce`, .howto/take-an-address-way-in.md): once the list holds it, its card is brought into
 * sight (smoothly, unless the device asks for less motion), given the focus and lit for a moment, and the address lets it
 * go, so the list coming again or a reload does not bring it back. One the list does not hold yet is waited for a few
 * seconds — the server's answer may bring it (Codex, 04.11, twice: the list's own «checking» is not an answer, its cache
 * comes first with no check under way) — and let go after that, lighting nothing, so it never jumps under the person's
 * hands later. The id lit now, or null.
 */
export function useListArrival(notes: readonly StudyNote[]): string | null {
  const wayIn = useWayInOnce();
  const [at, setAt] = useState<string | null>(null);
  const [lit, setLit] = useState<string | null>(null);
  // Read once the page stands at its own address: on a move from another page the router writes it after the first
  // render, and read then the address is still the reader's, whose own `at=` is a verse (live probe, 04.11). The browser
  // moving to another entry takes the way in that entry names, or none (Codex, 04.11).
  useEffect(() => {
    setAt(readListArrival());
    const moved = () => setAt(readListArrival());
    window.addEventListener('popstate', moved);
    return () => window.removeEventListener('popstate', moved);
  }, []);
  // Not held after the wait: the way in is let go, and the address forgets it.
  useEffect(() => {
    if (!at) return undefined;
    const giveUp = window.setTimeout(() => {
      if (wayIn.isTaken(at)) return;
      wayIn.take(at);
      forgetListArrival();
      setAt(null);
    }, ARRIVAL_WAIT_MS);
    return () => window.clearTimeout(giveUp);
  }, [at, wayIn]);
  useEffect(() => {
    if (!at || !wayIn.arriving(at) || !notes.some((note) => note.id === at)) return undefined;
    const letGo = () => { wayIn.take(at); forgetListArrival(); setAt(null); };
    setLit(at);
    // Taken where it is brought, not where it is planned: a timer cleared on the way leaves it still to take.
    const bring = window.setTimeout(() => {
      const card = Array.from(document.querySelectorAll<HTMLElement>('[data-note-id]')).find((each) => each.dataset.noteId === at);
      if (!card) return;
      const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      card.scrollIntoView?.({ block: 'center', behavior: still ? 'auto' : 'smooth' });
      card.querySelector<HTMLElement>('[role="button"][tabindex="0"]')?.focus({ preventScroll: true });
      letGo();
    }, 50);
    return () => window.clearTimeout(bring);
  }, [at, notes, wayIn]);
  // The light leaves on its own clock.
  useEffect(() => {
    if (!lit) return undefined;
    const leave = window.setTimeout(() => setLit(null), LIT_MS);
    return () => window.clearTimeout(leave);
  }, [lit]);
  return lit;
}

/** The analyses' tab before the first one: an analysis is made on the Bible's text, so the way starts there. */
export function AnalysesInvitation() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center dark:border-gray-700 dark:bg-gray-900">
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-violet-600"><AnalysisIcon className="h-5 w-5 text-white" /></span>
      <p className="mt-1 text-base font-semibold text-gray-900 dark:text-gray-100">{t('studiesWorkspace.analysesEmptyTitle')}</p>
      <p className="max-w-md text-sm leading-relaxed text-gray-600 dark:text-gray-400">{t('studiesWorkspace.analysesEmptyHint')}</p>
      <Link href="/bible" className="mt-2 inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700">
        <BibleIcon className="h-4 w-4" aria-hidden="true" />
        {t('studiesWorkspace.openBible')}
      </Link>
    </div>
  );
}
