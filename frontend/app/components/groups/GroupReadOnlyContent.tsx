'use client';

import Link from 'next/link';
import { useTranslation } from 'react-i18next';

import MarkdownDisplay from '@/components/MarkdownDisplay';

import type { Group, GroupBlockTemplate } from '@/models/models';

/** Reading needs no editor, setup stage or write callback. The provider owns recovery. */
export function GroupReadOnlyContent({ group, reason }: { group: Group; reason?: string | null }) {
  const { t } = useTranslation();
  const placed = new Set(group.flow.map(item => item.templateId));
  const content = (template: GroupBlockTemplate | undefined) => template && <>
    {template.summary && <MarkdownDisplay content={template.summary} />}
    <MarkdownDisplay content={template.content} />
    {template.scriptureRefs?.map((reference, index) => <p key={index}>{reference}</p>)}
    {template.questions?.map((question, index) => <MarkdownDisplay key={index} content={question} />)}
  </>;
  return <article className="space-y-6 p-5">
    <Link href="/groups">{t('navigation.groups')}</Link>
    <p role="status">{reason}</p>
    <h1 className="text-2xl font-bold">{group.title}</h1>
    {group.description && <MarkdownDisplay content={group.description} />}
    {[...group.flow].sort((a, b) => a.order - b.order).map(item => {
      const template = group.templates.find(entry => entry.id === item.templateId);
      return <section key={item.id} className="space-y-2">
        <h2 className="text-xl font-semibold">{item.instanceTitle || template?.title}</h2>
        {item.durationMin != null && <p>{item.durationMin} {t('groupFlow.minutesShort')}</p>}
        {content(template)}
        {item.instanceNotes && <MarkdownDisplay content={item.instanceNotes} />}
      </section>;
    })}
    {group.templates.filter(template => !placed.has(template.id)).map(template => <section key={template.id}>
      <h2 className="text-xl font-semibold">{template.title}</h2>{content(template)}
    </section>)}
    {group.meetingDates?.map(meeting => <section key={meeting.id}>
      <h2>{meeting.date}</h2><p>{meeting.location}</p><p>{meeting.audience}</p>
      {meeting.notes && <MarkdownDisplay content={meeting.notes} />}
    </section>)}
  </article>;
}
