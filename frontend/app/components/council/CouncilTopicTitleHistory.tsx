'use client';

import { useId, useState } from 'react';

import { useOwnerHistory } from '@/hooks/useOwnerHistory';
import { useTranslation } from '@locales/useTranslation';

import type { CouncilTopicTitleHistoryPage } from '@/data-engine/councilTopicTitleAction';
import type { CouncilTopic } from '@/models/models';

type Entry = CouncilTopicTitleHistoryPage['entries'][number];

export function CouncilTopicTitleHistory({ owner, generation, councilId, topics, disabled, onRestore }: {
  owner: string;
  generation: string;
  councilId: string;
  topics: readonly CouncilTopic[];
  disabled: boolean;
  onRestore: (id: string, title: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const { open, history, loading, failed, toggle, load } = useOwnerHistory<Entry, CouncilTopicTitleHistoryPage>({
    owner, generation, id: councilId,
    path: '/api/data-engine/documents/councils/' + encodeURIComponent(councilId) + '/topic-title-history',
    resourceId: page => page.councilId,
  });
  const [restoring, setRestoring] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const entries = history?.entries.flatMap(record => record.fields.map(field => ({ field, key: record.id + ':' + field.rowId }))) ?? [];
  const byId = new Map(topics.map(topic => [topic.id, topic]));
  const heading = t('council.topicTitleHistory.title');
  const words = (title: string) => title || t('council.topicTitleHistory.untitled');
  const button = 'min-h-8 text-xs font-medium text-emerald-700 hover:underline disabled:opacity-50 dark:text-emerald-400';
  const restore = async (rowId: string, title: string) => {
    setRestoring(true);
    setRestoreFailed(false);
    try { await onRestore(rowId, title); }
    catch { setRestoreFailed(true); }
    finally { setRestoring(false); }
  };
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
            <p className="font-medium">{topic ? words(topic.title) : t('council.topicTitleHistory.removed')}</p>
            <p>{t('council.topicTitleHistory.earlier', { value: words(field.value) })}</p>
            <p>{t('council.history.kept', { value: words(field.winnerValue) })}</p>
            {topic && <button type="button" className={button} disabled={disabled || restoring || topic.title === field.value}
              onClick={() => void restore(topic.id, field.value)}>{t('council.topicTitleHistory.restore')}</button>}
          </li>;
        })}
      </ul>}
      {history?.nextCursor && <button type="button" className={button} disabled={loading} onClick={() => void load(history.nextCursor!)}>
        {t('council.history.more')}
      </button>}
    </section>}
  </div>;
}
