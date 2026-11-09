'use client';

import { useId, useState } from 'react';

import { useOwnerHistory } from '@/hooks/useOwnerHistory';
import { hasRecordedCouncilTopicOutcome, isCouncilOutcome, readCouncilOutcome, sameCouncilOutcome } from '@/utils/councilTopicOutcome';
import { editHistoryShown } from '@/utils/editHistory';
import { useTranslation } from '@locales/useTranslation';

import { councilOutcomeWords } from './councilOutcomeWords';

import type { CouncilAssemblyHistoryPage } from '@/data-engine/councilAssemblyAction';
import type { CouncilOutcome, CouncilOutcomeHistoryPage } from '@/data-engine/councilOutcomeAction';
import type { CouncilTopicKind, CouncilTopicKindHistoryPage } from '@/data-engine/councilTopicKindAction';
import type { CouncilTopicTitleHistoryPage } from '@/data-engine/councilTopicTitleAction';
import type { CouncilTopic } from '@/models/models';

type Page = CouncilTopicTitleHistoryPage | CouncilAssemblyHistoryPage | CouncilTopicKindHistoryPage | CouncilOutcomeHistoryPage;
type Entry = Page['entries'][number];
type HistoryField = { field: 'title'; onRestore: (topic: CouncilTopic, value: string) => Promise<void> }
  | { field: 'forAssembly'; onRestore: (topic: CouncilTopic, value: boolean) => Promise<void> }
  | { field: 'kind'; onRestore: (topic: CouncilTopic, value: CouncilTopicKind) => Promise<void> }
  | { field: 'outcome'; onRestore: (topic: CouncilTopic, value: CouncilOutcome) => Promise<void> };

const historyField = {
  title: { path: '/topic-title-history', title: 'council.topicTitleHistory.title', restore: 'council.topicTitleHistory.restore' },
  forAssembly: { path: '/assembly-history', title: 'council.assemblyHistory.title', restore: 'council.assemblyHistory.restore' },
  outcome: { path: '/topic-outcome-history', title: 'council.outcomeHistory.title', restore: 'council.outcomeHistory.restore' },
  kind: { path: '/topic-kind-history', title: 'council.topicKindHistory.title', restore: 'council.topicKindHistory.restore' },
};

export function CouncilTopicHistory({ owner, generation, councilId, topics, disabled, ...selected }: {
  owner: string;
  generation: string;
  councilId: string;
  topics: readonly CouncilTopic[];
  disabled: boolean;
} & HistoryField) {
  const { t } = useTranslation();
  const id = useId();
  const config = historyField[selected.field];
  const { open, history, loading, failed, toggle, load } = useOwnerHistory<Entry, Page>({
    owner, generation, id: councilId,
    path: '/api/data-engine/documents/councils/' + encodeURIComponent(councilId) + config.path,
    resourceId: page => page.councilId,
  });
  const [restoring, setRestoring] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const entries = history?.entries.flatMap(record => record.fields.filter(field => field.field === selected.field).map(field => ({ field, key: record.id + ':' + field.rowId }))) ?? [];
  const byId = new Map(topics.map(topic => [topic.id, topic]));
  const heading = t(config.title);
  const topicName = (name: string) => name || t('council.topicTitleHistory.untitled');
  const words = (value: string | boolean | CouncilOutcome, topic?: CouncilTopic) => {
    if (isCouncilOutcome(value)) return councilOutcomeWords(value, topic, t);
    if (selected.field === 'kind') return t(value === 'info' ? 'council.topic.kindInfo' : 'council.topic.kindDecision');
    return typeof value === 'string' ? topicName(value)
      : t(value ? 'council.assemblyHistory.marked' : 'council.assemblyHistory.unmarked');
  };
  const current = (topic: CouncilTopic) => selected.field === 'outcome' ? readCouncilOutcome(topic) : selected.field === 'kind' ? topic.kind ?? 'decision'
    : selected.field === 'forAssembly' ? Boolean(topic.forAssembly) : topic.title;
  const isCurrent = (topic: CouncilTopic, value: string | boolean | CouncilOutcome) => {
    const shown = current(topic);
    return shown === value || (isCouncilOutcome(shown) && isCouncilOutcome(value) && sameCouncilOutcome(shown, value));
  };
  const button = 'min-h-8 text-xs font-medium text-emerald-700 hover:underline disabled:opacity-50 dark:text-emerald-400';
  const restore = async (topic: CouncilTopic, value: string | boolean | CouncilOutcome) => {
    setRestoring(true);
    setRestoreFailed(false);
    try {
      if (selected.field === 'title' && typeof value === 'string') await selected.onRestore(topic, value);
      if (selected.field === 'forAssembly' && typeof value === 'boolean') await selected.onRestore(topic, value);
      if (selected.field === 'outcome' && isCouncilOutcome(value)) await selected.onRestore(topic, value);
      if (selected.field === 'kind' && (value === 'decision' || value === 'info')) await selected.onRestore(topic, value);
    }
    catch { setRestoreFailed(true); }
    finally { setRestoring(false); }
  };
  if (!editHistoryShown()) return null;
  return <div className="space-y-2">
    <button type="button" aria-expanded={open} aria-controls={id} className={button} onClick={toggle} disabled={loading}>{heading}</button>
    {open && <section id={id} aria-label={heading} className="space-y-2 text-sm">
      {loading && <p role="status">{t('council.history.loading')}</p>}
      {failed && <p role="alert">{t('council.history.unavailable')}</p>}
      {restoreFailed && <p role="alert">{t('council.history.restoreFailed')}</p>}
      {history && !entries.length && !history.nextCursor && <p>{t('council.history.empty')}</p>}
      {entries.length > 0 && <ul className="space-y-2">
        {entries.map(({ key, field }) => {
          const topic = byId.get(field.rowId);
          return <li key={key} className="break-words rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
            <p className="font-medium">{topic ? topicName(topic.title) : t('council.topicTitleHistory.removed')}</p>
            <p>{t('council.topicTitleHistory.earlier', { value: words(field.value, topic) })}</p>
            <p>{t('council.history.kept', { value: words(field.winnerValue, topic) })}</p>
            {topic && <button type="button" className={button}
              disabled={disabled || restoring || isCurrent(topic, field.value)
                || (field.field === 'outcome' && (field.scope !== (topic.kind ?? 'decision')
                  || Boolean(field.value.acceptedOptionId && !topic.options.some(option => option.id === (field.value as CouncilOutcome).acceptedOptionId)))) || (selected.field === 'kind' && hasRecordedCouncilTopicOutcome(topic))}
              onClick={() => void restore(topic, field.value)}>{t(config.restore)}</button>}
          </li>;
        })}
      </ul>}
      {history?.nextCursor && <button type="button" className={button} disabled={loading} onClick={() => void load(history.nextCursor!)}>
        {t('council.history.more')}
      </button>}
    </section>}
  </div>;
}
