import { outlinePointConflictComparison } from '@/components/plan-editor/outlinePointPlacementWords';
import { readSermonConflict } from '@/data-engine/react.client';
import { formatDateForLocale } from '@/utils/dateFormatter';
import { isDateOnlyKey, shownDayOf } from '@/utils/dateOnly';
import { fieldLabel } from '@/utils/storedFieldLabel';

import type { TextComparison } from '@/data-engine/DataSyncStatus';
import type { SessionCheckpoint } from '@/data-engine/session';
import type { Json } from '@/data-engine/types';
import type { TFunction } from 'i18next';

export function sermonConflictComparison(checkpoint: SessionCheckpoint, t: TFunction, language: string): TextComparison | undefined {
  const placement = outlinePointConflictComparison(checkpoint, t);
  if (placement) return placement;
  const comparison = readSermonConflict(checkpoint);
  if (!comparison) return undefined;
  const { identity, kind } = comparison;
  if (kind === 'verse') {
    return { identity, title: t('addSermon.verseLabel'), mine: comparison.mine, stored: comparison.stored, scopedChoice: true };
  }
  if (kind === 'preparation-confirmation') {
    const format = (checked: boolean) => t(checked ? 'common.confirmationChecked' : 'common.confirmationUnchecked');
    return { identity, valueKind: 'field', title: fieldLabel(t, comparison.field),
      mine: format(comparison.mine), stored: format(comparison.stored), scopedChoice: true };
  }
  if (kind === 'exegetical-point') {
    const removed = t('dataSync.exegeticalPointRemoved');
    const versions = { identity, valueKind: 'field' as const, title: t('dataSync.exegeticalPointTitle'),
      mine: comparison.mine ?? removed, stored: comparison.stored ?? removed };
    if (!comparison.scoped) {
      return { ...versions, description: t('dataSync.exegeticalPointMultipleConflicts'),
        actions: { local: t('dataSync.useLocalVersion'), stored: t('dataSync.useStoredVersion'), confirmStored: 'common.discardChanges' } };
    }
    return { ...versions, scopedChoice: true, actions: {
        local: t(comparison.mine === null ? 'dataSync.exegeticalPointRemove' : 'dataSync.exegeticalPointKeepMine'),
        stored: t(comparison.stored === null ? 'dataSync.exegeticalPointRemove' : 'dataSync.exegeticalPointKeepSaved'),
        ...(comparison.stored === null && { confirmStored: 'dataSync.confirmStoredPointRemoval' }),
      } };
  }
  const date = (value: Json | undefined) => {
    if (typeof value !== 'string' || !value) return t('calendar.dateNotSet');
    const day = shownDayOf(value);
    return isDateOnlyKey(day) ? formatDateForLocale(day, language, { month: 'short', day: 'numeric', year: 'numeric' }) || value : value;
  };
  if (kind === 'date') {
    return { identity, valueKind: 'field', title: t('calendar.date'), mine: date(comparison.mine), stored: date(comparison.stored), scopedChoice: true };
  }
  return { identity, valueKind: 'removed-row', title: t('calendar.editPreachDate'), mine: date(comparison.date) + '\n' + comparison.notes,
    stored: t('calendar.preachingDateRemoved') };
}
