'use client';

import Link from 'next/link';
import { useTranslation } from 'react-i18next';

import MarkdownDisplay from '@/components/MarkdownDisplay';
import OutlineBoard from '@/components/plan-editor/OutlineBoard';
import { readPlanText, renderPlanWithFallback } from '@/utils/planText';

import type { Sermon } from '@/models/models';

/**
 * Presentation only. Never mount a draft editor against a copy that cannot accept writes.
 * Why editing is off is said once, for the whole app, by DeviceStorageNotice; not repeated here.
 */
export function SermonReadOnlyContent({ sermon, structure = false }: {
  sermon: Sermon; structure?: boolean;
}) {
  const { t } = useTranslation();
  const plan = renderPlanWithFallback(sermon, readPlanText(sermon));
  return <article className="space-y-6 p-5">
    <Link href={`/sermons/${encodeURIComponent(sermon.id)}`}>{t('navigation.sermons')}</Link>
    <h1 className="text-2xl font-bold">{sermon.title}</h1>
    <p>{sermon.verse}</p>
    {structure ? <>
      <OutlineBoard value={sermon.outline ?? { introduction: [], main: [], conclusion: [] }} onChange={() => undefined} isReadOnly showNotes />
      {sermon.thoughts.map(thought => <MarkdownDisplay key={thought.id} content={thought.text} />)}
    </> : <MarkdownDisplay content={[plan.introduction, plan.main, plan.conclusion].filter(Boolean).join('\n\n')} />}
  </article>;
}
