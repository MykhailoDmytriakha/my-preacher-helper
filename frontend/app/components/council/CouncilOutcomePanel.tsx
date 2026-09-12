'use client';

import { Check, PauseCircle, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isInfoTopic, outcomeText, topicState, type TopicOutcome } from '@/utils/council';

import type { CouncilTopic } from '@/models/models';
import '@locales/i18n';

/**
 * THE OUTCOME OF ONE SECTION — the same panel whether the pastor is standing in the meeting
 * (`/conduct`) or filling the record in at home from the council page. One place to say
 * "we accepted this option", "here is what we decided", "we put it off", "we took it off".
 *
 * The "discussed" mark is not a control here: it follows the content. Pick an option or write
 * a decision and the section counts as discussed; clear both and it does not. The owner asked
 * for exactly that ("галочка условная, а не ручная").
 */
export function CouncilOutcomePanel({
  topic,
  onWrite,
  size = 'md',
}: {
  topic: CouncilTopic;
  onWrite: (outcome: TopicOutcome) => void;
  /** `lg` while conducting — thumbs, not cursors. */
  size?: 'md' | 'lg';
}) {
  const { t } = useTranslation();
  const large = size === 'lg';
  const state = topicState(topic);
  const info = isInfoTopic(topic);

  // The typed line is local until it is committed: Enter or leaving the field is the natural
  // end, and writing the whole council on every keystroke is churn a phone does not need.
  const [decision, setDecision] = useState(topic.decision ?? '');
  useEffect(() => setDecision(topic.decision ?? ''), [topic.decision]);
  const commitDecision = () => {
    if ((topic.decision ?? '') === decision.trim()) return;
    onWrite({ decision: decision.trim() });
  };

  const optionClass = (accepted: boolean) =>
    `flex w-full items-center gap-3 rounded-xl border text-left transition ${large ? 'px-4 py-3 text-base' : 'px-3 py-2.5 text-sm'} ${
      accepted
        ? 'border-indigo-500 bg-indigo-50 font-bold text-indigo-800 dark:border-indigo-500 dark:bg-indigo-950/50 dark:text-indigo-200'
        : 'border-gray-200 bg-white text-gray-800 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200'
    }`;

  /**
   * ONE SHAPE FOR EVERY OUTCOME. "Decided", "said", "deferred", "withdrawn" are four answers to
   * the same question — what happened to this section at the council — and four answers of one
   * kind wear one coat: same pill, same size, the chosen one filled. The words match: each one
   * a participle about the matter, the same word the list shows afterwards.
   */
  const outcomeClass = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border font-semibold transition ${large ? 'px-4 py-2.5 text-sm' : 'px-3 py-2 text-xs'} ${
      active
        ? 'border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700 dark:border-indigo-500 dark:bg-indigo-500'
        : 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'
    }`;

  if (info) {
    /*
     * A SECTION THAT IS ONLY SAID has one question at the council — was it said? — so it gets
     * one big button and the two ways of not saying it. No options, no line of what was
     * decided: nothing is decided here.
     */
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onWrite({ told: state !== 'told' })}
          aria-pressed={state === 'told'}
          className={outcomeClass(state === 'told')}
          data-testid="council-told"
        >
          <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
          {t('council.topic.tell')}
        </button>
        <button
          type="button"
          onClick={() => onWrite({ resolution: state === 'postponed' ? null : 'postponed' })}
          aria-pressed={state === 'postponed'}
          className={outcomeClass(state === 'postponed')}
        >
          <PauseCircle className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          {t('council.topic.postponed')}
        </button>
        <button
          type="button"
          onClick={() => onWrite({ resolution: state === 'dropped' ? null : 'dropped' })}
          aria-pressed={state === 'dropped'}
          className={outcomeClass(state === 'dropped')}
        >
          <XCircle className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          {t('council.topic.dropped')}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {topic.options.length > 0 && (
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">{t('council.topic.options')}</p>
          <ul className="mt-2 space-y-2">
            {topic.options.map((option) => {
              const accepted = option.id === topic.acceptedOptionId;
              return (
                <li key={option.id}>
                  <button
                    type="button"
                    onClick={() => onWrite({ acceptedOptionId: accepted ? '' : option.id })}
                    aria-pressed={accepted}
                    className={optionClass(accepted)}
                    data-testid={`council-option-${option.id}`}
                  >
                    <span
                      className={`flex shrink-0 items-center justify-center rounded-full border ${large ? 'h-6 w-6' : 'h-5 w-5'} ${
                        accepted ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-300 dark:border-gray-600'
                      }`}
                      aria-hidden="true"
                    >
                      {accepted && <Check className={large ? 'h-3.5 w-3.5' : 'h-3 w-3'} strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1">{option.text}</span>
                    {accepted && <span className="text-xs font-semibold">{t('council.topic.accepted')}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <label className="block">
        <span className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">{t('council.conduct.decisionLabel')}</span>
        <input
          value={decision}
          onChange={(event) => setDecision(event.target.value)}
          onBlur={commitDecision}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault();
              commitDecision();
            }
          }}
          placeholder={t('council.topic.decisionPlaceholder')}
          className={`mt-1.5 w-full rounded-xl border border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500 ${
            large ? 'px-3 py-2.5 text-base' : 'px-3 py-2 text-sm'
          }`}
          data-testid="council-decision"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        {/* The first one is a reading, not a button: it lights when the section has a decision. */}
        <span
          className={`${outcomeClass(state === 'decided')} ${state === 'decided' ? '' : 'border-dashed text-gray-400 dark:text-gray-500'}`}
          data-testid="council-discussed"
          aria-live="polite"
        >
          <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
          {t('council.topic.discussedMark')}
        </span>
        <button
          type="button"
          onClick={() => onWrite({ resolution: state === 'postponed' ? null : 'postponed' })}
          aria-pressed={state === 'postponed'}
          className={outcomeClass(state === 'postponed')}
          data-testid="council-postponed"
        >
          <PauseCircle className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          {t('council.topic.postponed')}
        </button>
        <button
          type="button"
          onClick={() => onWrite({ resolution: state === 'dropped' ? null : 'dropped' })}
          aria-pressed={state === 'dropped'}
          className={outcomeClass(state === 'dropped')}
          data-testid="council-dropped"
        >
          <XCircle className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          {t('council.topic.dropped')}
        </button>
      </div>
    </div>
  );
}

/** One line a list can show for a section: the decision, or what the council did instead; empty while open. */
export function useOutcomeLine() {
  const { t } = useTranslation();
  return (topic: CouncilTopic, outcome: string): string => {
    if (outcome) return outcome;
    const state = topicState(topic);
    if (state === 'postponed') return t('council.topic.postponedShort');
    if (state === 'dropped') return t('council.topic.droppedShort');
    if (state === 'told') return t('council.topic.told');
    return '';
  };
}

/**
 * The same line, never empty: an open section says what is still missing — "not discussed"
 * for one that expects a decision, "not said" for one that is only said.
 */
export function useTopicStateLine() {
  const { t } = useTranslation();
  const outcomeLine = useOutcomeLine();
  return (topic: CouncilTopic): { text: string; open: boolean } => {
    const line = outcomeLine(topic, outcomeText(topic));
    if (line) return { text: line, open: false };
    return { text: isInfoTopic(topic) ? t('council.topic.notTold') : t('council.topic.notDiscussed'), open: true };
  };
}
