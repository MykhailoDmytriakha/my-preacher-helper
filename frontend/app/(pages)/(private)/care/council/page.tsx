'use client';

import { ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline';
import { ArrowLeft, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTopicStateLine } from '@/components/council/CouncilOutcomePanel';
import { Chip } from '@/components/ui/Chip';
import { useCouncils } from '@/hooks/useCouncils';
import { councilProgress, daysUntil, splitForList, topicPreview } from '@/utils/council';
import { formatDate, formatDateOnly } from '@/utils/dateFormatter';
import { CARE_CARD_TONES } from '@/utils/themeColors';

import type { Council } from '@/models/models';
import type { FormEvent } from 'react';
import '@locales/i18n';

/**
 * BROTHERS' COUNCIL — the list of councils: the ones being prepared and the ones already held.
 *
 * Two groups and one action. A council the pastor is preparing is the thing he opens during
 * the week to drop a section into; a held one is a record he opens to check what was decided.
 * The owner described the page in exactly these words: "где мой список того, что было, где
 * возможность создать новый, где которые я подготавливаю, где прошлые".
 */

const tone = CARE_CARD_TONES.indigo;

const buttonPrimary =
  'inline-flex items-center gap-2 rounded-full bg-indigo-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-indigo-800 disabled:opacity-60 dark:bg-indigo-600 dark:hover:bg-indigo-500';
const buttonQuiet =
  'inline-flex items-center gap-2 rounded-full border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-600 transition hover:border-gray-400 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800';
const inputClass =
  'w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500';

export default function CouncilListPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { councils, loading, error, refresh, createCouncil } = useCouncils();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');

  const { preparing, past } = splitForList(councils);
  const isEmpty = councils.length === 0;

  const openCreate = () => {
    /*
     * The suggested name comes from the translation file like every other word on the screen.
     * It used to be decided by comparing another string against its English text, which meant
     * every language that was not recognised as English silently got the Russian word — a
     * Ukrainian pastor was offered «Совет» for his own council.
     */
    setTitle(t('council.newCouncilName'));
    setDate('');
    setCreating(true);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const council = createCouncil({ title: title.trim() || t('council.title'), date: date || undefined });
    setCreating(false);
    if (council) router.push(`/care/council/${council.id}`);
  };

  return (
    <div className="mx-auto w-full max-w-4xl">
      <Link
        href="/care"
        className={`inline-flex items-center gap-1.5 text-sm font-semibold transition ${tone.title} hover:opacity-80`}
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        {t('council.backToPlane')}
      </Link>

      <header className="mt-4">
        <div className="flex items-center justify-between gap-4">
          <h1 className={`flex min-w-0 items-center gap-3 text-2xl font-extrabold tracking-tight sm:text-3xl ${tone.title}`}>
            <ChatBubbleLeftRightIcon className="h-7 w-7 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            <span className="min-w-0 truncate">{t('council.title')}</span>
          </h1>
          {!isEmpty && !creating && (
            <button type="button" onClick={openCreate} className={buttonPrimary} data-testid="council-new">
              <Plus className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              {t('council.newCouncil')}
            </button>
          )}
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-600 dark:text-gray-400">
          {t('council.subtitle')}
        </p>
      </header>

      {creating && (
        <form
          onSubmit={submit}
          className="mt-6 flex flex-col gap-3 rounded-2xl border border-indigo-200/60 bg-indigo-50/60 p-4 sm:flex-row sm:items-end dark:border-indigo-900/60 dark:bg-indigo-950/30"
        >
          <label className="flex-1 text-xs font-semibold text-gray-600 dark:text-gray-300">
            {t('council.newCouncilPlaceholder')}
            <input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className={`mt-1 ${inputClass}`}
              data-testid="council-new-title"
            />
          </label>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">
            {t('council.newCouncilDate')}
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className={`mt-1 ${inputClass}`}
            />
          </label>
          <div className="flex gap-2">
            <button type="submit" className={buttonPrimary}>
              {t('council.create')}
            </button>
            <button type="button" onClick={() => setCreating(false)} className={buttonQuiet}>
              {t('council.cancel')}
            </button>
          </div>
        </form>
      )}

      {loading && isEmpty ? (
        <div className="mt-8 h-24 animate-pulse rounded-2xl bg-gray-100 dark:bg-gray-800" />
      ) : isEmpty && error ? (
        /*
         * A LIST THAT COULD NOT BE READ IS NOT AN EMPTY LIST. Before the rules for this
         * collection were live, the read was refused and the page said "no councils yet" —
         * an invitation to create a twin of what was already there. A failed read says so
         * and offers to ask again.
         */
        <section className="mt-8 rounded-2xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900/60 dark:bg-amber-950/30" role="alert">
          <p className="text-sm text-amber-900 dark:text-amber-200">{t('council.readFailed')}</p>
          <button type="button" onClick={() => void refresh()} className={`mt-3 ${buttonQuiet}`} data-testid="council-retry">
            {t('council.retry')}
          </button>
        </section>
      ) : isEmpty ? (
        <section className="mt-10 flex flex-col items-start gap-3">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{t('council.emptyTitle')}</h2>
          <p className="max-w-md text-sm text-gray-600 dark:text-gray-400">{t('council.emptyHint')}</p>
          {!creating && (
            <button type="button" onClick={openCreate} className={buttonPrimary}>
              <Plus className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              {t('council.newCouncil')}
            </button>
          )}
        </section>
      ) : (
        <>
          <Group title={t('council.preparing')} empty={t('council.noPreparing')} councils={preparing} />
          <Group title={t('council.past')} empty={t('council.noPast')} councils={past} />
        </>
      )}

    </div>
  );
}

function Group({ title, empty, councils }: { title: string; empty: string; councils: Council[] }) {
  return (
    <section className="mt-8">
      <h2 className="px-1 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">{title}</h2>
      {councils.length === 0 ? (
        <p className="mt-2 px-1 text-sm text-gray-600 dark:text-gray-400">{empty}</p>
      ) : (
        /*
         * EACH COUNCIL IS ITS OWN CARD. They used to be rows inside one panel, and on a phone —
         * where there is no hover to reveal a row — two past councils read as one long list with
         * no edge between them (the owner's words: "не видно, где карточка закончилась"). A
         * border and a gap say "one thing" without any pointer at all.
         */
        <ul className="mt-2 space-y-3">
          {councils.map((council) => (
            <li key={council.id}>
              <CouncilRow council={council} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** How many sections a card lists before it says "N more": a council rarely has more, and a card is not a page. */

function CouncilRow({ council }: { council: Council }) {
  const { t } = useTranslation();
  const stateLine = useTopicStateLine();
  const held = council.status === 'held';
  const progress = councilProgress(council);
  const forAssembly = council.topics.filter((topic) => topic.forAssembly).length;

  /**
   * The line under the title answers the question a person opens the list with: for a council
   * still ahead — when, and how soon; for a held one — when it was.
   */
  const when = held
    ? t('council.heldOn', { date: council.heldAt ? formatDate(council.heldAt) : '' })
    : council.date
      ? `${formatDateOnly(council.date)} · ${relativeDay(council.date, t)}`
      : t('council.noDate');

  // The cap and the "+N left" rule live in `utils/council`, shared with the calendar card, so
  // the two surfaces cannot show different amounts of the same council.
  const { topics: shown, hidden } = topicPreview(council);

  return (
    <Link
      href={`/care/council/${council.id}`}
      /*
       * A council ahead wears the section's tint; a held one is plain paper. The two groups read
       * apart from three metres away, and neither card melts into the white page — the owner's
       * complaint was exactly that ("всё с белым сливается").
       */
      className={`group flex items-start gap-3 rounded-2xl border px-4 py-4 shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
        held
          ? 'border-gray-300/80 bg-white hover:border-indigo-300 active:bg-indigo-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-indigo-700 dark:active:bg-indigo-950/40'
          : 'border-indigo-200 bg-indigo-50/50 hover:border-indigo-400 active:bg-indigo-100/70 dark:border-indigo-900/70 dark:bg-indigo-950/20 dark:hover:border-indigo-700 dark:active:bg-indigo-950/50'
      } ${tone.focus}`}
      data-testid={`council-row-${council.id}`}
    >
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm font-bold tracking-tight text-gray-900 transition-colors dark:text-gray-100 ${tone.rowTitleHover}`}>
          {council.title}
        </span>
        <span className="mt-0.5 block text-xs leading-snug text-gray-600 dark:text-gray-400">{when}</span>

        {/*
          THE SECTIONS THEMSELVES, NOT THEIR NUMBER. The owner opens this list to remember what
          he is carrying to the council, or what was decided at the last one — a count answers
          neither. Held councils show the decision under each section; a section nobody got to
          says so, quietly, instead of hiding among the decided ones.
        */}
        {shown.length > 0 && (
          <ol className="mt-2 space-y-1">
            {shown.map((topic, index) => {
              const line = held ? stateLine(topic) : null;
              return (
                <li key={topic.id} className="flex gap-2 text-sm">
                  <span className="w-4 shrink-0 text-right text-xs font-bold tabular-nums text-gray-500 dark:text-gray-500">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-gray-900 dark:text-gray-100">{topic.title}</span>
                    {line && (
                      <span
                        className={`block truncate text-xs ${
                          line.open ? 'text-gray-500 dark:text-gray-500' : 'text-indigo-700 dark:text-indigo-300'
                        }`}
                      >
                        {line.text}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
            {hidden > 0 && (
              <li className="pl-6 text-xs text-gray-400 dark:text-gray-500">{t('council.moreTopics', { count: hidden })}</li>
            )}
          </ol>
        )}

        <span className="mt-2 flex flex-wrap gap-1.5">
          {held && (
            <Chip size="sm" tone="neutral">
              {t('council.discussedCount', { done: progress.done, total: progress.total })}
            </Chip>
          )}
          {forAssembly > 0 && (
            <Chip size="sm" tone="indigo">
              {t('council.forAssemblyCount', { count: forAssembly })}
            </Chip>
          )}
        </span>
      </span>
      <span className="mt-0.5 shrink-0 text-gray-400 transition-colors group-hover:text-indigo-600 dark:text-gray-500 dark:group-hover:text-indigo-300" aria-hidden="true">
        ›
      </span>
    </Link>
  );
}

function relativeDay(date: string, t: (key: string, options?: Record<string, unknown>) => string): string {
  const days = daysUntil(date);
  if (days === 0) return t('council.today');
  if (days < 0) return t('council.dateGone');
  return t('council.inDays', { count: days });
}
