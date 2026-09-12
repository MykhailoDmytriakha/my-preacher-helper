'use client';

import { ArrowLeft, Check, ChevronLeft, ChevronRight, Landmark, List, Megaphone, PauseCircle, XCircle } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { CouncilOutcomePanel, useOutcomeLine } from '@/components/council/CouncilOutcomePanel';
import FloatingTextScaleControls from '@/components/FloatingTextScaleControls';
import MarkdownDisplay from '@/components/MarkdownDisplay';
import { useCouncil } from '@/hooks/useCouncils';
import {
  applyOutcome,
  councilProgress,
  firstOpenTopicIndex,
  holdCouncil,
  isInfoTopic,
  outcomeText,
  reopenCouncil,
  topicState,
  type TopicOutcome,
} from '@/utils/council';

import type { Council, CouncilTopic } from '@/models/models';
import '@locales/i18n';

/**
 * CONDUCTING A COUNCIL — the screen open on the pastor's phone while the brothers talk.
 *
 * One section at a time, big, with the prepared answers a tap away; the decisions on the
 * table are buttons, and a line to type what was decided when it was none of them. It covers
 * the navigation the way a group meeting does (`/groups/[id]/conduct`): a person running a
 * meeting must not be one tap from leaving it by accident. On a wide screen the list of
 * sections stands at the side the whole time; on a phone it is one tap away.
 *
 * Every mark is written the moment it is made, so leaving this screen loses nothing and
 * coming back resumes at the first section still open.
 */

const buttonPrimary =
  'inline-flex items-center justify-center gap-2 rounded-full bg-indigo-700 px-5 py-3 text-sm font-bold text-white transition hover:bg-indigo-800 disabled:opacity-50 dark:bg-indigo-600 dark:hover:bg-indigo-500';
const buttonQuiet =
  'inline-flex items-center justify-center gap-2 rounded-full border border-gray-300 px-4 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800';

export default function CouncilConductPage() {
  const { id } = useParams();
  const councilId = typeof id === 'string' ? id : '';
  const { t } = useTranslation();
  const router = useRouter();
  const { council, loading, updateCouncil } = useCouncil(councilId);

  // `null` until the person moves: the first open section is where the meeting resumes.
  const [chosenIndex, setChosenIndex] = useState<number | null>(null);
  /*
   * WHERE THE MEETING RESUMED, remembered once. The resume point is "the first section still
   * open", and marking an outcome on that very section moves it — so a screen derived from it
   * live jumps to the next section the moment the pastor ticks something, while he is still
   * speaking about this one, and "next" then skips a section. The entry point is read on the
   * first render that has the council and never again.
   */
  const resumeIndex = useRef<number | null>(null);
  const [overview, setOverview] = useState(false);
  const [showQuestions, setShowQuestions] = useState(false);

  const backToCouncil = () => router.push(`/care/council/${councilId}`);

  if (!council) {
    return (
      <Shell>
        {loading ? (
          <div className="m-auto h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
        ) : (
          <Centered message={t('council.detail.notFound')} onBack={backToCouncil} backLabel={t('council.detail.backToList')} />
        )}
      </Shell>
    );
  }

  if (council.status === 'held') {
    return (
      <Shell>
        <Centered message={t('council.conduct.alreadyHeld')} onBack={backToCouncil} backLabel={t('council.conduct.back')} />
      </Shell>
    );
  }

  const topics = council.topics;
  if (topics.length === 0) {
    return (
      <Shell>
        <Centered message={t('council.conduct.noTopics')} onBack={backToCouncil} backLabel={t('council.conduct.back')} />
      </Shell>
    );
  }

  if (resumeIndex.current === null) resumeIndex.current = firstOpenTopicIndex(council);
  const index = Math.min(chosenIndex ?? resumeIndex.current, topics.length - 1);
  const topic = topics[index];
  const progress = councilProgress(council);
  const isLast = index === topics.length - 1;

  const write = (topicId: string, outcome: TopicOutcome) =>
    updateCouncil(council.id, (current) => ({
      ...current,
      topics: current.topics.map((item) =>
        item.id === topicId ? applyOutcome(item, outcome, { at: new Date().toISOString(), trackChanges: false }) : item
      ),
    }));

  /**
   * ONE PRESS, AND A WAY BACK. A second "are you sure?" read as the same button twice; the
   * undo on the toast is the safety net instead, and it costs nothing when it is not needed.
   */
  const finish = () => {
    const at = new Date().toISOString();
    updateCouncil(council.id, (current) => holdCouncil(current, at));
    router.push(`/care/council/${council.id}`);
    toast.success(t('council.detail.finished'), {
      // Eight seconds, not four: an undo a person cannot reach in time is not an undo.
      duration: 8000,
      action: {
        label: t('council.detail.undo'),
        onClick: () => updateCouncil(council.id, (current) => reopenCouncil(current, new Date().toISOString())),
      },
    });
  };

  const goTo = (next: number) => {
    setChosenIndex(Math.max(0, Math.min(next, topics.length - 1)));
    setShowQuestions(false);
    setOverview(false);
  };

  const sectionList = (
    <SectionList council={council} currentIndex={index} onSelect={goTo} onFinish={finish} />
  );

  return (
    <Shell>
      <header className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
        <button type="button" onClick={backToCouncil} className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-700 dark:text-indigo-300">
          <ArrowLeft className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          {t('council.conduct.back')}
        </button>
        <span className="min-w-0 flex-1 truncate text-center text-sm font-bold text-gray-900 dark:text-gray-100">{council.title}</span>
        {/* On a wide screen the sections stand at the side; the toggle exists for the phone. */}
        <button
          type="button"
          onClick={() => setOverview((value) => !value)}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold lg:hidden ${
            overview ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-200' : 'text-gray-600 dark:text-gray-300'
          }`}
          aria-pressed={overview}
        >
          <List className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          {t('council.conduct.overview')}
        </button>
      </header>

      {/*
        THE SECTIONS STAND ON THE LEFT, AND THE BOTTOM BAR RUNS UNDER EVERYTHING. Reading starts
        at the left edge, so the running order of the council belongs there — the eye finds "where
        are we" before it reads the section, instead of travelling to the far corner for it. And
        the bar with "back", the count and "next" is the floor of the whole screen, not of one
        column: a panel that runs past it to the bottom of the glass reads as a second, unfinished
        page beside the first.
      */}
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-80 shrink-0 overflow-y-auto border-r border-gray-200 bg-gray-50/60 px-3 py-4 lg:block dark:border-gray-800 dark:bg-gray-900/40">
          {sectionList}
        </aside>

        {overview ? (
          <main className="flex-1 overflow-y-auto px-4 py-4 lg:hidden">{sectionList}</main>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <main className="flex-1 overflow-y-auto px-4 py-5">
              <div className="prose-scaled mx-auto w-full max-w-2xl">
                <p className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                  {t('council.conduct.section', { index: index + 1, total: topics.length })}
                </p>
                <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-gray-900 sm:text-3xl dark:text-gray-100">{topic.title}</h1>
                {isInfoTopic(topic) && (
                  <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-gray-600 dark:text-gray-400">
                    <Megaphone className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
                    {t('council.topic.kindInfo')}
                  </p>
                )}
                {topic.forAssembly && (
                  /*
                   * LOUD ON PURPOSE. At the meeting this is the one flag that must not be missed —
                   * the matter leaves this room and goes to the members' meeting — so it is a filled
                   * banner here, not the quiet chip the preparation page wears.
                   */
                  <p className="mt-3 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3.5 py-2 text-sm font-bold text-white shadow-sm dark:bg-indigo-500">
                    <Landmark className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
                    {t('council.conduct.assemblyBanner')}
                  </p>
                )}
                {topic.summary && (
                  <div className="mt-3 text-base leading-relaxed text-gray-800 dark:text-gray-300">
                    <MarkdownDisplay content={topic.summary} />
                  </div>
                )}

                {topic.questions.length > 0 && (
                  <div className="mt-4 rounded-2xl border border-gray-200 dark:border-gray-800">
                    <button
                      type="button"
                      onClick={() => setShowQuestions((value) => !value)}
                      className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-gray-800 dark:text-gray-200"
                      aria-expanded={showQuestions}
                    >
                      {t('council.conduct.questionsToggle')}
                      <ChevronRight
                        className={`h-4 w-4 transition-transform ${showQuestions ? 'rotate-90' : ''}`}
                        strokeWidth={2}
                        aria-hidden="true"
                      />
                    </button>
                    {showQuestions && (
                      <ul className="space-y-3 border-t border-gray-200 px-4 py-3 dark:border-gray-800">
                        {topic.questions.map((question) => (
                          <li key={question.id} className="text-sm">
                            <p className="font-semibold text-gray-900 dark:text-gray-100">{question.question}</p>
                            {question.answer && (
                              <p className="mt-1 ml-3 border-l-2 border-indigo-200 pl-3 text-gray-700 dark:border-indigo-900 dark:text-gray-400">
                                {question.answer}
                              </p>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                <section className="mt-5">
                  <CouncilOutcomePanel key={topic.id} topic={topic} onWrite={(outcome) => write(topic.id, outcome)} size="lg" />
                </section>
              </div>
            </main>

          </div>
        )}
      </div>

      <footer className="flex items-center gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-800">
        <button type="button" onClick={() => goTo(index - 1)} disabled={index === 0} className={buttonQuiet}>
          <ChevronLeft className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          {t('council.conduct.prev')}
        </button>
        <span className="flex-1 text-center text-xs text-gray-600 dark:text-gray-400">
          {t('council.discussedCount', { done: progress.done, total: progress.total })}
        </span>
        {isLast ? (
          <button type="button" onClick={finish} className={buttonPrimary} data-testid="council-finish">
            <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
            {t('council.conduct.finish')}
          </button>
        ) : (
          <button type="button" onClick={() => goTo(index + 1)} className={buttonPrimary} data-testid="council-next">
            {t('council.conduct.next')}
            <ChevronRight className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          </button>
        )}
      </footer>

      {/*
        THE SAME ROUND CONTROL AS IN THE NOTES. A council is read aloud from a tablet held at
        arm's length, and the size that suits a desk does not suit that. The notes already own
        this: one provider, one CSS variable, one remembered preference — so the button is
        borrowed whole rather than built again here.

        It is lifted clear of the bottom bar: at its usual height it sat on top of "finish the
        council", and two round things in one corner, one of which ends the meeting, is exactly
        the kind of neighbourhood a thumb gets wrong. Above the overlay's own layer, too, or the
        screen would swallow it.
      */}
      <FloatingTextScaleControls className="!bottom-24 z-[210]" />
    </Shell>
  );
}

/** Every section with where it stands; the current one lit; a tap jumps there. */
function SectionList({
  council,
  currentIndex,
  onSelect,
  onFinish,
}: {
  council: Council;
  currentIndex: number;
  onSelect: (index: number) => void;
  onFinish: () => void;
}) {
  const { t } = useTranslation();
  const outcomeLine = useOutcomeLine();
  const progress = councilProgress(council);

  return (
    <div>
      <p className="px-1 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
        {t('council.conduct.sections')} · {t('council.discussedCount', { done: progress.done, total: progress.total })}
      </p>
      <ol className="mt-2 space-y-1.5">
        {council.topics.map((item, itemIndex) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onSelect(itemIndex)}
              aria-current={itemIndex === currentIndex ? 'step' : undefined}
              className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                itemIndex === currentIndex
                  ? 'border-indigo-400 bg-indigo-50 dark:border-indigo-600 dark:bg-indigo-950/40'
                  : 'border-gray-200 bg-white hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800'
              }`}
            >
              <StateMark topic={item} index={itemIndex} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="block truncate text-sm font-bold text-gray-900 dark:text-gray-100">{item.title}</span>
                  {item.forAssembly && (
                    <Landmark className="h-3.5 w-3.5 shrink-0 text-indigo-600 dark:text-indigo-300" strokeWidth={2.25} aria-label={t('council.conduct.assemblyBanner')} />
                  )}
                </span>
                {outcomeLine(item, outcomeText(item)) && (
                  <span className="block truncate text-xs text-indigo-700 dark:text-indigo-300">{outcomeLine(item, outcomeText(item))}</span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div className="mt-5 flex justify-end">
        <button type="button" onClick={onFinish} className={buttonPrimary}>
          <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
          {t('council.conduct.finish')}
        </button>
      </div>
    </div>
  );
}

function StateMark({ topic, index }: { topic: CouncilTopic; index: number }) {
  const state = topicState(topic);
  const base = 'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold';
  if (state === 'decided' || state === 'told') {
    return (
      <span className={`${base} bg-indigo-600 text-white`} aria-hidden="true">
        <Check className="h-3 w-3" strokeWidth={3} />
      </span>
    );
  }
  if (state === 'postponed') {
    return (
      <span className={`${base} bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200`} aria-hidden="true">
        <PauseCircle className="h-3.5 w-3.5" strokeWidth={2.5} />
      </span>
    );
  }
  if (state === 'dropped') {
    return (
      <span className={`${base} bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200`} aria-hidden="true">
        <XCircle className="h-3.5 w-3.5" strokeWidth={2.5} />
      </span>
    );
  }
  return (
    <span className={`${base} border border-gray-300 text-gray-500 dark:border-gray-600 dark:text-gray-400`} aria-hidden="true">
      {index + 1}
    </span>
  );
}

/**
 * The meeting screen covers the application, and the keyboard has to agree with the eye: without
 * this, Tab walks off the last button into the navigation underneath — visible to a screen reader,
 * invisible to everyone else — and a pastor mid-council finds himself on another page.
 */
function Shell({ children }: { children: React.ReactNode }) {
  const frame = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !frame.current) return;
      const reachable = frame.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      const visible = [...reachable].filter((element) => element.offsetParent !== null);
      if (visible.length === 0) return;
      const first = visible[0];
      const last = visible[visible.length - 1];
      const active = document.activeElement;
      if (!frame.current.contains(active)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div
      ref={frame}
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[200] flex flex-col bg-white dark:bg-gray-950"
    >
      {children}
    </div>
  );
}

function Centered({ message, onBack, backLabel }: { message: string; onBack: () => void; backLabel: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-gray-600 dark:text-gray-400">{message}</p>
      <button type="button" onClick={onBack} className={buttonQuiet}>
        <ArrowLeft className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        {backLabel}
      </button>
    </div>
  );
}
