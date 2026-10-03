'use client';

import { ArrowLeftIcon, CalendarDaysIcon, MapPinIcon, PlayIcon, UsersIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';

import { FlowItemSummary } from '@/components/groups/FlowItemSummary';
import MarkdownDisplay from '@/components/MarkdownDisplay';
import { normalizeFlow } from '@/utils/groupFlow';

import type { Group, GroupBlockTemplate } from '@/models/models';

/** What a block holds beyond its content — kept visible, nothing of the group is hidden while reading. */
function BlockDetails({ template }: { template: GroupBlockTemplate }) {
  return <>
    {template.summary && <div className="mt-1 text-xs text-gray-600 dark:text-gray-300"><MarkdownDisplay content={template.summary} compact className="!text-xs" /></div>}
    {template.scriptureRefs?.length ? <p className="mt-1 text-xs font-medium text-gray-600 dark:text-gray-300">{template.scriptureRefs.join(' · ')}</p> : null}
    {template.questions?.length ? <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-gray-600 dark:text-gray-300">
      {template.questions.map((question, index) => <li key={index}><MarkdownDisplay content={question} compact className="!text-xs [&_p]:my-0" /></li>)}
    </ul> : null}
  </>;
}

/**
 * THE GROUP FOR READING, WHILE THE DEVICE STORAGE IS SILENT (BUG-20261002-group-read-only-copy-bare-page).
 *
 * The same page in its own clothes — the header card, the meeting's blocks as numbered rows, the
 * block summary the editing page draws — with nothing to edit and nothing hidden. Start Meeting
 * stays: the conduct screen runs on the same copy. Why editing is off is said once, for the whole
 * app, by DeviceStorageNotice above the page; repeating it here was the third copy on screen.
 */
export function GroupReadOnlyContent({ group }: { group: Group }) {
  const { t } = useTranslation();
  const flow = normalizeFlow(group.flow);
  const templatesById = new Map(group.templates.map(template => [template.id, template]));
  const placed = new Set(flow.map(item => item.templateId));
  const unplaced = group.templates.filter(template => !placed.has(template.id));
  const meetings = group.meetingDates ?? [];

  return (
    <section className="space-y-6">
      <header className="rounded-3xl border border-gray-200/70 bg-gradient-to-br from-emerald-600/10 via-cyan-600/10 to-blue-600/10 p-6 shadow-sm dark:border-gray-800 dark:from-emerald-500/10 dark:via-cyan-500/10 dark:to-blue-500/10">
        <Link href="/groups" className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-gray-200 transition hover:-translate-y-0.5 hover:shadow-md dark:bg-gray-900/80 dark:text-gray-200 dark:ring-gray-800">
          <ArrowLeftIcon className="h-4 w-4" />
          {t('navigation.groups', { defaultValue: 'Groups' })}
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{group.title}</h1>
        {group.description && <div className="mt-2 text-sm text-gray-700 dark:text-gray-300"><MarkdownDisplay content={group.description} compact /></div>}
        {meetings.map(meeting => (
          <div key={meeting.id} className="mt-4 space-y-2 text-sm text-gray-700 dark:text-gray-300">
            <p className="flex flex-wrap gap-x-6 gap-y-2">
              {meeting.date && <span className="inline-flex items-center gap-2"><CalendarDaysIcon className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden />{meeting.date}</span>}
              {meeting.location && <span className="inline-flex items-center gap-2"><MapPinIcon className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden />{meeting.location}</span>}
              {meeting.audience && <span className="inline-flex items-center gap-2"><UsersIcon className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden />{meeting.audience}</span>}
            </p>
            {meeting.notes && <MarkdownDisplay content={meeting.notes} compact />}
          </div>
        ))}
      </header>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('groupFlow.title', { defaultValue: 'Group Flow' })}</h2>
          {flow.length > 0 && (
            <Link href={`/groups/${group.id}/conduct`} className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 shadow-sm transition hover:bg-emerald-100 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950/60">
              <PlayIcon className="h-4 w-4" />
              {t('conduct.startButton', { defaultValue: 'Start Meeting' })}
            </Link>
          )}
        </div>
        {flow.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
            {t('groupFlow.emptyState', { defaultValue: 'No blocks yet' })}
          </p>
        ) : (
          <ol className="space-y-2">
            {flow.map((item, index) => {
              // A step whose template is gone still shows what it has: nothing of the group is hidden.
              const template = templatesById.get(item.templateId);
              return (
                <li key={item.id} className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
                  <span className="w-5 flex-shrink-0 pt-0.5 text-center text-xs font-bold tabular-nums text-gray-400 dark:text-gray-500">{index + 1}</span>
                  <FlowItemSummary flowItem={item} template={template} fullNotes>
                    {template && <BlockDetails template={template} />}
                  </FlowItemSummary>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {unplaced.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">{t('workspaces.groups.templates.title', { defaultValue: 'Block templates' })}</h2>
          <ul className="space-y-2">
            {unplaced.map(template => (
              <li key={template.id} className="rounded-xl border border-gray-200 px-4 py-3 dark:border-gray-700">
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{template.title}</p>
                {template.content && <MarkdownDisplay content={template.content} compact className="!text-xs !text-gray-500 dark:!text-gray-400" />}
                <BlockDetails template={template} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
