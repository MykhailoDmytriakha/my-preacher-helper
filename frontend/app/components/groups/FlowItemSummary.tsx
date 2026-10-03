'use client';

import { useTranslation } from 'react-i18next';

import MarkdownDisplay from '@/components/MarkdownDisplay';

import type { GroupBlockTemplate, GroupFlowItem } from '@/models/models';
import type { ReactNode } from 'react';

/**
 * HOW A MEETING BLOCK READS IN A LIST — one rule for the flow row on the group page and for the
 * same group shown for reading while the device storage is silent: the step's title, the block
 * content as formatted Markdown at caption size, the leader's notes and the duration.
 *
 * Renders two siblings for the caller's flex row: the text column and the duration badge.
 */
export function FlowItemSummary({ flowItem, template, fullNotes = false, children }: {
  flowItem: GroupFlowItem;
  /** Missing when the block's template is gone: the step still shows its own title, notes and time. */
  template?: GroupBlockTemplate;
  /** The leader's notes in full, line breaks kept — the row clamps them to two lines. */
  fullNotes?: boolean;
  /** More of the block under its content, e.g. its questions in the reading view. */
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const content = template?.content?.trim();
  const notes = flowItem.instanceNotes?.trim();
  return (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">
            {flowItem.instanceTitle || template?.title}
          </span>
        </div>
        {content && (
          /*
           * Block content is Markdown from the rich editor — rendered as on the meeting screen, at
           * caption size. The renderer gives headings and lists classes of their own, so they are
           * restated for its descendants instead of the wrapper. A link in it opens its page and
           * leaves the row as it was.
           */
          <div
            role="presentation"
            onClick={(event) => {
              if ((event.target as HTMLElement).closest('a')) event.stopPropagation();
            }}
          >
            <MarkdownDisplay
              content={content}
              compact
              className="mt-0.5 !text-xs !text-gray-500 dark:!text-gray-400 [&_h3]:!my-0.5 [&_h3]:!text-xs [&_h4]:!my-0.5 [&_h4]:!text-xs [&_h5]:!my-0.5 [&_h5]:!text-xs [&_h6]:!my-0.5 [&_h6]:!text-xs [&_li]:my-0 [&_ol]:!my-0.5 [&_p]:my-0.5 [&_ul]:!my-0.5"
            />
          </div>
        )}
        {children}
        {notes && (
          <p className={`mt-0.5 text-xs italic text-indigo-500 dark:text-indigo-400 ${fullNotes ? 'whitespace-pre-wrap' : 'line-clamp-2'}`}>
            {notes}
          </p>
        )}
      </div>

      {flowItem.durationMin ? (
        <span className="flex-shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-200">
          {flowItem.durationMin}{t('groupFlow.stats.duration', { defaultValue: 'm' })}
        </span>
      ) : null}
    </>
  );
}
