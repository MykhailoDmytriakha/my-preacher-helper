'use client';

import { CheckCircle2 } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { Chip } from '@/components/ui/Chip';
import { getLatestPreachedDate, getNextPlannedDate } from '@/utils/preachDateStatus';
import { formatDateOnly } from '@utils/dateFormatter';

import type { Sermon } from '@/models/models';
import type { ChipTone } from '@/utils/chipClasses';

const TEXT_PRIMARY_CLASSES = 'text-gray-800 dark:text-gray-100';
const DASHBOARD_PREACHED_KEY = 'dashboard.preached';
const CALENDAR_STATUS_PLANNED_KEY = 'calendar.status.planned';

/**
 * The one rule for the sermon's status dates: the latest preached date wins; a planned
 * date is only offered while nothing has been preached yet.
 */
export function getSermonStatusDateTexts(sermon: Sermon): {
  formattedPreachedDate: string | null;
  formattedPlannedDate: string | null;
} {
  const latestPreachedDate = getLatestPreachedDate(sermon);
  const nextPlannedDate = getNextPlannedDate(sermon);
  const formattedPreachedDate = latestPreachedDate?.date ? formatDateOnly(latestPreachedDate.date) : null;
  const formattedPlannedDate =
    !formattedPreachedDate && nextPlannedDate?.date ? formatDateOnly(nextPlannedDate.date) : null;
  return { formattedPreachedDate, formattedPlannedDate };
}

interface SermonStatusChipProps {
  formattedPreachedDate: string | null;
  formattedPlannedDate: string | null;
}

/** "Preached <date>" (emerald) or "Planned <date>" (amber); silent when there is no date. */
export function SermonStatusChip({ formattedPreachedDate, formattedPlannedDate }: SermonStatusChipProps) {
  const { t } = useTranslation();
  const hasPreachedDate = Boolean(formattedPreachedDate);
  const hasPlannedDate = !hasPreachedDate && Boolean(formattedPlannedDate);
  if (!hasPreachedDate && !hasPlannedDate) return null;
  const statusDateText = formattedPreachedDate ?? formattedPlannedDate ?? '';
  const statusLabel = hasPreachedDate
    ? t(DASHBOARD_PREACHED_KEY)
    : t(CALENDAR_STATUS_PLANNED_KEY, { defaultValue: 'Planned' });
  // Preached is the app's green, still-to-come is amber — the same pair the calendar uses.
  const statusTone: ChipTone = hasPreachedDate ? 'emerald' : 'amber';

  return (
    <Chip tone={statusTone} size="sm" className="gap-1.5" icon={<CheckCircle2 className="w-3 h-3" />}>
      <span className="uppercase tracking-wide text-[10px]">{statusLabel}</span>
      <span className={TEXT_PRIMARY_CLASSES}>{statusDateText}</span>
    </Chip>
  );
}
