'use client';

import { useTranslation } from 'react-i18next';

import { PrayerStatus } from '@/models/models';

const STATUS_STYLES: Record<PrayerStatus, string> = {
  active: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  answered: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  not_answered: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
};

interface Props {
  status: PrayerStatus;
  className?: string;
}

export default function PrayerStatusBadge({ status, className = '' }: Props) {
  const { t } = useTranslation();
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[status]} ${className}`}>
      {t(`prayer.status.${status}`)}
    </span>
  );
}
