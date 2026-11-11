'use client';

import { ArrowLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import { useBookTexts } from '@/components/bible/useBookTexts';
import { useVerseWindow } from '@/components/bible/VerseWindow';
import { DataCollectionStatus } from '@/data-engine/DataCollectionStatus';
import { useAppLocale } from '@/hooks/useAppLocale';
import { useConfirm } from '@/hooks/useConfirm';
import { ownPlaceKey, useOccasionPlaces, type OwnPlace, type OwnPlaceRef } from '@/hooks/useOccasionPlaces';
import { useRouteId } from '@/hooks/useRouteId';
import { namesAPlace } from '@/utils/bibleLink';
import { canGoBackToPage } from '@/utils/modalHistory.client';
import { placeShown, versesPreview, type PlaceVerse } from '@/utils/placeText';
import { awaitWriteOperation } from '@/utils/recoverableWrite';
import { referenceBibleFor } from '@/utils/scriptureReferenceNumbering';
import { parseReferenceText } from '@/utils/scriptureReferenceParser';
import { EMERALD_ACTION } from '@/utils/themeColors';
import { occasionById, occasionNameKey } from '@/utils/wordForOccasion';
import { useTranslation } from '@locales/useTranslation';

import type { AppLocale } from '@/utils/appLocale';
import type { BibleId } from '@/utils/bibles';
import type { ScriptureRefShape } from '@/utils/scriptureReference';
import type { ReactNode } from 'react';

import '@locales/i18n';

/** A run of verses shows whole, up to the cross-reference window's eight; a whole chapter, its opening two. */
const RUN_VERSES_SHOWN = 8;
const CHAPTER_VERSES_SHOWN = 2;

type Place = ScriptureRefShape & { bible: BibleId; chapter: number };

/**
 * ONE TOPIC of the word for the occasion: its places, each with its words in the reader's Bible,
 * so the pastor reads them here and keeps the one he needs. A press opens the place over the page
 * (`useVerseWindow`), with the way on into the Bible — as a service order's step does.
 *
 * Under the Gideons' places stand the pastor's own (`useOccasionPlaces`), shown the same way, with
 * their words: he adds a place by typing it as he writes it ("Пс 22:4"), in his Bible's numbering.
 *
 * The Gideons' places are in the King James numbering the indexes print (`utils/wordForOccasion.ts`);
 * every label and every word on this page are the reader's Bible's, through the numbering module.
 */
export default function WordForOccasionSituationPage() {
  const id = useRouteId();
  const occasion = id ? occasionById(id) : undefined;
  const { t } = useTranslation();
  const { locale } = useAppLocale();
  const router = useRouter();
  const verseWindow = useVerseWindow();
  const { confirm, confirmDialog } = useConfirm();
  const own = useOccasionPlaces(occasion ? occasion.id : null);
  const bible = referenceBibleFor(locale);
  const books = useMemo(
    () => [...new Set([...(occasion?.places ?? []), ...own.places.map((place) => place.ref)].map((place) => place.book))],
    [occasion, own.places],
  );
  const texts = useBookTexts(books, bible);

  // Back keeps the index's search: the index is in history whenever a chip led here.
  const back = () => (canGoBackToPage() ? router.back() : router.push('/care/word'));
  // Each place's name and words from the one Bible this page reads them in (`placeShown`).
  const shownOf = (place: Place) => placeShown(place, bible, { text: texts.get(place.book), locale });
  const known = new Set([...(occasion?.places ?? []), ...own.places.map((place) => place.ref)].map(ownPlaceKey));
  // Removing is asked first: a place he added by hand is his own work, and a stray press must not take it.
  // A refusal is said, never swallowed: a place still on its way (added offline a moment ago) cannot be
  // removed yet, and a silent "removed" that comes back later is worse than the honest "not yet".
  const removeOwn = async (place: OwnPlace, label: string) => {
    if (!(await confirm({ title: { key: 'careWord.own.removeTitle', values: { place: label } }, description: { key: 'careWord.own.removeDescription' }, confirmText: { key: 'careWord.own.removeConfirm' } }))) return;
    await own.remove(place).catch(() => { toast.error(t('careWord.own.removeFailed', { place: label })); });
  };

  return (
    <div className="mx-auto w-full max-w-4xl">
      <button
        type="button"
        onClick={back}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 transition hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        {t('care.sections.word.title')}
      </button>

      {!occasion ? (
        <section className="mt-16 flex flex-col items-center px-6 text-center">
          <p className="text-sm text-gray-600 dark:text-gray-300">{t('careWord.notFound')}</p>
          <Link href="/care/word" className="mt-4 text-sm font-semibold text-emerald-700 underline-offset-4 hover:underline dark:text-emerald-300">
            {t('care.sections.word.title')}
          </Link>
        </section>
      ) : (
        <>
          <header className="mt-4">
            <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 dark:text-gray-100 sm:text-3xl">
              {t(occasionNameKey(occasion.id))}
            </h1>
            <p className="mt-1.5 text-sm text-gray-600 dark:text-gray-400">
              {t('careWord.places', { count: occasion.places.length })}
            </p>
          </header>

          <ul className="mt-5 flex flex-col gap-2.5">
            {occasion.places.map((place) => {
              const shown = shownOf(place);
              const label = shown.name;
              return (
                <li key={label}>
                  <PlaceCard
                    label={label}
                    note={place.sources > 1 ? t('careWord.inIndexes', { count: place.sources }) : null}
                    words={wordsOf(shown.verses, place)}
                    loadingWords={t('careWord.textLoading')}
                    openLabel={t('careWord.openPlace', { place: label })}
                    onOpen={() => verseWindow.open(place)}
                  />
                </li>
              );
            })}
          </ul>

          <section aria-labelledby="own-places-title" className="mt-8">
            <h2 id="own-places-title" className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              {t('careWord.own.title')}
            </h2>
            <div className="mt-3"><DataCollectionStatus state={own.state} /></div>
            {own.places.length > 0 ? (
              <ul className="flex flex-col gap-2.5">
                {own.places.map((place) => {
                  const shown = shownOf(place.ref);
                  const label = shown.name;
                  return (
                    <li key={place.ids[0]}>
                      <PlaceCard
                        label={label}
                        note={null}
                        words={wordsOf(shown.verses, place.ref)}
                        loadingWords={t('careWord.textLoading')}
                        openLabel={t('careWord.openPlace', { place: label })}
                        onOpen={() => verseWindow.open(place.ref)}
                        action={(
                          // Shown on hover and on keyboard focus; a phone has no hover, so there it always stands.
                          <button
                            type="button"
                            onClick={() => { void removeOwn(place, label); }}
                            aria-label={t('careWord.own.remove', { place: label })}
                            title={t('careWord.own.remove', { place: label })}
                            className="relative z-10 -my-2.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-gray-400 opacity-0 transition hover:bg-red-50 hover:text-red-600 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 group-hover:opacity-100 dark:text-gray-500 dark:hover:bg-red-950/40 dark:hover:text-red-400 [@media(hover:none)]:opacity-100"
                          >
                            <Trash2 className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                          </button>
                        )}
                      />
                    </li>
                  );
                })}
              </ul>
            ) : (
              // "No places" only when the list is known whole: an unread list is not an empty one.
              <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">{t(own.complete ? 'careWord.own.empty' : 'careWord.own.loading')}</p>
            )}
            {own.canAdd && (
              <AddPlace
                bible={bible}
                locale={locale}
                isKnown={(place) => known.has(ownPlaceKey(place))}
                onAdd={(place) => awaitWriteOperation(own.add(place), () => undefined).then(() => undefined)}
              />
            )}
          </section>
        </>
      )}
      {verseWindow.sheet}
      {confirmDialog}
    </div>
  );
}

function wordsOf(verses: readonly PlaceVerse[], place: Place): string | null {
  return versesPreview(verses, place.fromVerse === undefined ? CHAPTER_VERSES_SHOWN : RUN_VERSES_SHOWN);
}

/**
 * One place as a card: its label, a quiet note, its words; a press anywhere on the card opens it.
 * The opening button stretches over the whole card (its `after:` layer), so a card can also carry
 * its own action (`action`, the remove of an own place) beside the arrow, never inside a button.
 */
function PlaceCard({ label, note, words, loadingWords, openLabel, onOpen, action }: {
  label: string; note: ReactNode; words: string | null; loadingWords: string; openLabel: string; onOpen: () => void; action?: ReactNode;
}) {
  return (
    <div className="group relative flex w-full items-start gap-3 rounded-2xl border border-gray-200 bg-white p-4 transition hover:border-emerald-300 hover:bg-emerald-50/40 has-[:focus-visible]:border-emerald-400 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-emerald-800 dark:hover:bg-emerald-950/20">
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2.5">
          <button
            type="button"
            onClick={onOpen}
            aria-label={openLabel}
            className="text-left text-sm font-bold text-emerald-700 after:absolute after:inset-0 after:rounded-2xl after:content-[''] focus-visible:outline-none dark:text-emerald-300"
          >
            {label}
          </button>
          {note && <span className="text-xs text-gray-500 dark:text-gray-400">{note}</span>}
        </span>
        <span className="mt-1.5 block font-serif text-[17px] leading-relaxed text-gray-800 dark:text-gray-200">
          {words ?? <span className="font-sans text-sm text-gray-500 dark:text-gray-400">{loadingWords}</span>}
        </span>
      </span>
      {action}
      <ChevronRight className="mt-0.5 h-[18px] w-[18px] shrink-0 text-gray-400 dark:text-gray-500" strokeWidth={2} aria-hidden="true" />
    </div>
  );
}

/**
 * «Add a place»: one quiet button; pressed, a field where the pastor types the place as he writes
 * it. It is read in his interface's language and kept in his Bible's numbering; a place the page
 * already holds, or one his Bible does not have, is said plainly instead of being kept.
 */
function AddPlace({ bible, locale, isKnown, onAdd }: {
  bible: BibleId;
  locale: AppLocale;
  isKnown: (place: OwnPlaceRef) => boolean;
  onAdd: (place: OwnPlaceRef) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const close = () => { setOpen(false); setTyped(''); setProblem(null); };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const parsed = parseReferenceText(typed, { locale });
    const place = parsed?.book && parsed.chapter ? { ...parsed, bible, chapter: parsed.chapter } as OwnPlaceRef : null;
    // A place this Bible has, every end of it: "Ин 3:16-999" names no place (`namesAPlace`, the reader's own rule).
    if (!place || !namesAPlace(place)) { setProblem(t('careWord.own.invalid')); return; }
    if (isKnown(place)) { setProblem(t('careWord.own.duplicate')); return; }
    const kept: OwnPlaceRef = {
      bible, book: place.book, chapter: place.chapter,
      ...(place.fromVerse !== undefined && { fromVerse: place.fromVerse }),
      ...(place.toVerse !== undefined && { toVerse: place.toVerse }),
      ...(place.endChapter !== undefined && { endChapter: place.endChapter }),
      // "Мф 5-7": a run of whole chapters keeps its end (Codex review, 2026-11-10).
      ...(place.toChapter !== undefined && place.toChapter !== place.chapter && { toChapter: place.toChapter }),
    };
    setSaving(true);
    onAdd(kept).then(close, () => setProblem(t('careWord.own.failed'))).finally(() => setSaving(false));
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-full border border-emerald-700 px-[18px] text-sm font-bold text-emerald-700 transition hover:bg-emerald-50 dark:border-emerald-500 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
      >
        <Plus className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        {t('careWord.own.add')}
      </button>
    );
  }
  return (
    <form onSubmit={submit} className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="own-place" className="sr-only">{t('careWord.own.fieldLabel')}</label>
        <input
          id="own-place"
          autoFocus
          value={typed}
          onChange={(event) => { setTyped(event.target.value); setProblem(null); }}
          onKeyDown={(event) => { if (event.key === 'Escape') close(); }}
          placeholder={t('careWord.own.placeholder')}
          autoComplete="off"
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? 'own-place-problem' : undefined}
          className="h-11 min-w-0 flex-[1_1_220px] rounded-xl border border-gray-300 bg-white px-3.5 text-[15px] text-gray-900 placeholder:text-gray-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        />
        <button
          type="submit"
          disabled={saving || !typed.trim()}
          className={`${EMERALD_ACTION} inline-flex min-h-11 items-center rounded-full px-5 text-sm font-bold transition disabled:opacity-60`}
        >
          {t('careWord.own.save')}
        </button>
        <button
          type="button"
          onClick={close}
          className="min-h-11 rounded-full px-3 text-sm font-semibold text-gray-600 transition hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          {t('careWord.own.cancel')}
        </button>
      </div>
      {problem && <p id="own-place-problem" role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">{problem}</p>}
    </form>
  );
}
