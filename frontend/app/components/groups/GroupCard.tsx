"use client";

import {
  CalendarDaysIcon,
  DocumentDuplicateIcon,
  EllipsisVerticalIcon,
  Squares2X2Icon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Group } from '@/models/models';

interface GroupCardProps {
  group: Group;
  onDelete?: () => void;
  deleting?: boolean;
}

const statusClasses: Record<Group['status'], string> = {
  draft: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
  active: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
};

const ISO_DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const parseMeetingDate = (value: string): Date | null => {
  if (!value) return null;

  if (ISO_DATE_ONLY_REGEX.test(value)) {
    const [yearString, monthString, dayString] = value.split('-');
    const year = Number(yearString);
    const month = Number(monthString);
    const day = Number(dayString);
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const resolvePrimaryMeetingDate = (meetingDates: Group['meetingDates']) => {
  const normalized = (meetingDates || [])
    .map((meetingDate) => {
      const parsed = parseMeetingDate(meetingDate.date);
      return parsed ? { raw: meetingDate.date, timestamp: parsed.getTime() } : null;
    })
    .filter((entry): entry is { raw: string; timestamp: number } => Boolean(entry))
    .sort((left, right) => left.timestamp - right.timestamp);

  if (normalized.length === 0) {
    return null;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTimestamp = today.getTime();

  const upcoming = normalized.find((entry) => entry.timestamp >= todayTimestamp);
  if (upcoming) {
    return { date: upcoming.raw, isUpcoming: true };
  }

  const latest = normalized[normalized.length - 1];
  return latest ? { date: latest.raw, isUpcoming: false } : null;
};

const formatMeetingDate = (value: string): string | null => {
  const parsed = parseMeetingDate(value);
  if (!parsed) return null;

  return new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(parsed);
};

export default function GroupCard({ group, onDelete, deleting = false }: GroupCardProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const meetingCount = (group.meetingDates || []).length;
  const primaryMeetingDate = resolvePrimaryMeetingDate(group.meetingDates);
  const meetingDateLabel = primaryMeetingDate?.isUpcoming
    ? t('workspaces.groups.itemsLabel.nextMeeting', { defaultValue: 'Next meeting' })
    : t('workspaces.groups.itemsLabel.lastMeeting', { defaultValue: 'Last meeting' });
  const meetingDateValue = primaryMeetingDate
    ? (formatMeetingDate(primaryMeetingDate.date) ||
      t('workspaces.groups.itemsLabel.noDate', { defaultValue: 'No date' }))
    : t('workspaces.groups.itemsLabel.noDate', { defaultValue: 'No date' });

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  useEffect(() => {
    if (!menuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        closeMenu();
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [menuOpen, closeMenu]);

  return (
    <article
      className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:-translate-y-[1px] hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
    >
      {/* Three-dot menu */}
      {onDelete && (
        <div ref={menuRef} className="absolute right-2 top-2 z-10">
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setMenuOpen((prev) => !prev);
            }}
            className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
            aria-label={t('common.more', { defaultValue: 'More options' })}
          >
            <EllipsisVerticalIcon className="h-5 w-5" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 w-40 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  closeMenu();
                  onDelete();
                }}
                disabled={deleting}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 transition hover:bg-red-50 disabled:opacity-60 dark:text-red-400 dark:hover:bg-red-950/30"
              >
                <TrashIcon className="h-4 w-4" />
                {deleting
                  ? t('common.deleting', { defaultValue: 'Deleting...' })
                  : t('workspaces.groups.actions.delete', { defaultValue: 'Delete' })}
              </button>
            </div>
          )}
        </div>
      )}

      <Link href={`/groups/${group.id}`} className="flex flex-1 flex-col">
        <div className="flex items-start justify-between gap-3 pr-8">
          <h3 className="text-lg font-semibold text-gray-900 transition-colors group-hover:text-blue-600 dark:text-gray-50 dark:group-hover:text-blue-400">
            {group.title}
          </h3>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${statusClasses[group.status]}`}>
            {t(`workspaces.series.form.statuses.${group.status}`, { defaultValue: group.status })}
          </span>
        </div>

        {group.description && (
          <p className="mt-2 line-clamp-2 text-sm text-gray-600 dark:text-gray-400">{group.description}</p>
        )}

        <div className="mt-4 grid grid-cols-3 gap-2 text-xs text-gray-600 dark:text-gray-300">
          <div className="rounded-lg bg-gray-50 px-2 py-2 text-center dark:bg-gray-900/60">
            <div className="inline-flex items-center gap-1">
              <DocumentDuplicateIcon className="h-3.5 w-3.5" />
              <span>{(group.templates || []).length}</span>
            </div>
            <div className="mt-1 text-[11px] opacity-80">
              {t('workspaces.groups.itemsLabel.templates', { defaultValue: 'Templates' })}
            </div>
          </div>
          <div className="rounded-lg bg-gray-50 px-2 py-2 text-center dark:bg-gray-900/60">
            <div className="inline-flex items-center gap-1">
              <Squares2X2Icon className="h-3.5 w-3.5" />
              <span>{(group.flow || []).length}</span>
            </div>
            <div className="mt-1 text-[11px] opacity-80">
              {t('workspaces.groups.itemsLabel.flowSteps', { defaultValue: 'Flow' })}
            </div>
          </div>
          <div className="rounded-lg bg-gray-50 px-2 py-2 text-center dark:bg-gray-900/60">
            <div className="inline-flex max-w-full items-center gap-1">
              <CalendarDaysIcon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{meetingDateValue}</span>
            </div>
            <div className="mt-1 text-[11px] opacity-80">{meetingDateLabel}</div>
          </div>
        </div>
      </Link>

      <div className="mt-4 flex items-center border-t border-gray-100 pt-3 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
        <span>
          {t('workspaces.groups.itemsLabel.meetings', { defaultValue: 'Meetings' })}: {meetingCount}
        </span>
      </div>
    </article>
  );
}
