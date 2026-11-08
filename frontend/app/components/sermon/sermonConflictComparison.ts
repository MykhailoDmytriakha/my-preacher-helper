import { readSermonConflictField } from '@/data-engine/sermonFieldChoice';
import { formatDateForLocale } from '@/utils/dateFormatter';
import { isDateOnlyKey, shownDayOf } from '@/utils/dateOnly';

import type { TextComparison } from '@/data-engine/DataSyncStatus';
import type { SessionCheckpoint } from '@/data-engine/session';
import type { Json } from '@/data-engine/types';
import type { TFunction } from 'i18next';

function row(value: Json | undefined) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

export function sermonConflictComparison(checkpoint: SessionCheckpoint, t: TFunction, language: string): TextComparison | undefined {
  // The document's buttons decide the whole conflict. Comparing one field would hide other choices.
  const { conflicts, draft, remoteCandidate } = checkpoint;
  if (conflicts.length !== 1 || !draft || !remoteCandidate?.value) return undefined;
  const { path, base } = conflicts[0];
  const mine = readSermonConflictField(draft, path), theirs = readSermonConflictField(remoteCandidate.value, path);
  const identity = JSON.stringify([path, mine, theirs, remoteCandidate.metadata, checkpoint.editGeneration]);
  if (JSON.stringify(mine) === JSON.stringify(theirs)) return undefined;
  const [field, rowId, property] = path;
  if (path.length === 1 && field === 'verse' && typeof mine.value === 'string' && typeof theirs.value === 'string') {
    return { identity, title: t('addSermon.verseLabel'), mine: mine.value, stored: theirs.value, scopedChoice: true };
  }
  if (field !== 'preachDates' || !rowId?.startsWith('id:')) return undefined;
  const date = (value: Json | undefined) => {
    if (typeof value !== 'string' || !value) return t('calendar.dateNotSet');
    const day = shownDayOf(value);
    return isDateOnlyKey(day) ? formatDateForLocale(day, language, { month: 'short', day: 'numeric', year: 'numeric' }) || value : value;
  };
  if (path.length === 3 && property === 'date' && readSermonConflictField(remoteCandidate.value, path.slice(0, 2)).exists) {
    return { identity, valueKind: 'field', title: t('calendar.date'), mine: date(mine.value), stored: date(theirs.value), scopedChoice: true };
  }
  const local = row(mine.value);
  if (path.length === 2 && !theirs.exists && typeof local?.notes === 'string' && local.notes !== row(base.value)?.notes) {
    return { identity, valueKind: 'removed-row', title: t('calendar.editPreachDate'), mine: date(local.date) + '\n' + local.notes,
      stored: t('calendar.preachingDateRemoved') };
  }
  return undefined;
}
