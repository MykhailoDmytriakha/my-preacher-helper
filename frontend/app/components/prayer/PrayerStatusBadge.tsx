'use client';

import { useTranslation } from 'react-i18next';

import { Chip } from '@/components/ui/Chip';
import { PrayerStatus } from '@/models/models';

import type { ChipTone } from '@/utils/chipClasses';

/**
 * A prayer's state as a chip tone. Answered is the app's success green, waiting is the
 * neutral plate, and a request still being carried wears the same blue the sermons use.
 */
const STATUS_TONES: Record<PrayerStatus, ChipTone> = {
  active: 'blue',
  answered: 'emerald',
  not_answered: 'neutral',
};

interface Props {
  status: PrayerStatus;
  className?: string;
}

export default function PrayerStatusBadge({ status, className = '' }: Props) {
  const { t } = useTranslation();
  return (
    <Chip tone={STATUS_TONES[status]} size="sm" className={className}>
      {t(`prayer.status.${status}`)}
    </Chip>
  );
}
