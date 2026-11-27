import { preachDateComparison } from '@/components/calendar/preachDateForm';
import { outlinePointConflictComparison } from '@/components/plan-editor/outlinePointPlacementWords';
import { outlineTitleComparison } from '@/components/plan-editor/outlineTitleComparison';
import { churchFieldWords, pendingScratchRemoval, pendingThoughtRemoval, readGuardedScratchTextReview, readPlacedSketchComparison, readSermonConflict, recoveredScratchRemoval, recoveredThoughtLock, recoveredThoughtRemoval } from '@/data-engine/react.client';
import { formatDateForLocale } from '@/utils/dateFormatter';
import { isDateOnlyKey, shownDayOf } from '@/utils/dateOnly';
import { fieldLabel } from '@/utils/storedFieldLabel';

import type { ApplyOutlineReview, TextComparison } from '@/data-engine/DataSyncStatus';
import type { SessionCheckpoint } from '@/data-engine/session';
import type { Json } from '@/data-engine/types';
import type { TFunction } from 'i18next';

export function sermonConflictComparison(checkpoint: SessionCheckpoint, t: TFunction, language: string, apply?: ApplyOutlineReview): TextComparison | undefined {
  const guarded = readGuardedScratchTextReview(checkpoint);
  if (guarded) return { ...guarded, title: t('scratch.card.label'), valueKind: 'field', scopedChoice: true,
    stored: guarded.stored ?? t('dataSync.emptyField') };
  const sketch = readPlacedSketchComparison(checkpoint);
  if (sketch) return { ...sketch, title: t('scratch.card.label'), valueKind: 'field', scopedChoice: true };
  const scratchRemoval = pendingScratchRemoval(checkpoint) ?? (checkpoint.remoteCandidate && !Object.keys(checkpoint.pending).length
    ? recoveredScratchRemoval(checkpoint, checkpoint.remoteCandidate) : undefined);
  if (scratchRemoval) {
    return { identity: scratchRemoval.identity, title: t('scratch.card.deleteConfirmTitle'), valueKind: 'field', scopedChoice: true,
      mine: t('scratch.card.delete') + '\n' + scratchRemoval.opening,
      stored: scratchRemoval.settled ? t('dataSync.emptyField') : scratchRemoval.stored,
      keepMineDisabled: scratchRemoval.settled, actions: { local: t('scratch.card.delete'), stored: t('dataSync.useStoredVersion') } };
  }
  const lock = checkpoint.remoteCandidate && !Object.keys(checkpoint.pending).length
    ? recoveredThoughtLock(checkpoint, checkpoint.remoteCandidate) : undefined;
  if (lock?.settled === false) {
    const label = (checked: boolean) => t(checked ? 'structure.locked' : 'structure.unlocked');
    return { identity: JSON.stringify([checkpoint.editGeneration, checkpoint.remoteCandidate?.metadata?.revision, lock.choices]),
      title: t('structure.thoughtLockState'), valueKind: 'field', scopedChoice: true,
      mine: lock.choices.map(({ text, checked }) => text + ' · ' + label(checked)).join('\n'),
      stored: lock.choices.map(({ text, stored }) => text + ' · ' + label(stored)).join('\n') };
  }
  const pendingRemoval = pendingThoughtRemoval(checkpoint);
  const privateRemoval = checkpoint.remoteCandidate && !Object.keys(checkpoint.pending).length
    ? recoveredThoughtRemoval(checkpoint, checkpoint.remoteCandidate) : undefined;
  const removal = pendingRemoval ?? (privateRemoval?.settled === false ? privateRemoval : undefined);
  if (removal) {
    const text = (value: string) => value || t('dataSync.emptyField');
    return { identity: removal.identity, title: t('dataSync.thoughtRemovalTitle'), valueKind: 'field', scopedChoice: true,
      mine: t('dataSync.thoughtRemoved') + '\n' + text(removal.opening), stored: removal.stored === undefined ? t('dataSync.thoughtRemoved') : text(removal.stored),
      keepMineDisabled: removal.settled,
      actions: { local: t('dataSync.removeThought'), stored: t('dataSync.keepSavedThought') } };
  }
  const placement = outlinePointConflictComparison(checkpoint, t, apply);
  if (placement) return placement;
  const title = outlineTitleComparison(checkpoint, t);
  if (title) return title;
  const comparison = readSermonConflict(checkpoint);
  if (!comparison) return undefined;
  const { identity, kind } = comparison;
  if (kind === 'preach-date-detail') return preachDateComparison(comparison.versions, identity, t, language);
  if (kind === 'note-text' || kind === 'plan-cell') {
    const title = kind === 'plan-cell' ? fieldLabel(t, 'planText')
      : t(comparison.scratch ? 'scratch.card.label' : 'planEditor.note.label');
    const openingCopy = kind === 'plan-cell' && comparison.unverified
      ? { heading: t('dataSync.unverifiedPlanCellTitle'), description: t('dataSync.unverifiedPlanCellDescription') } : {};
    return { identity, valueKind: 'field', title, ...openingCopy,
      mine: comparison.mine ?? t('dataSync.emptyField'), stored: comparison.stored ?? t('dataSync.emptyField'), scopedChoice: true };
  }
  if (kind === 'thought-text') {
    return { identity, title: t('thought.editorLabel'), valueKind: 'field', scopedChoice: true,
      mine: comparison.mine || t('dataSync.emptyField'), stored: comparison.stored || t('dataSync.emptyField') };
  }
  if (kind === 'verse') {
    return { identity, title: t('addSermon.verseLabel'), mine: comparison.mine, stored: comparison.stored, scopedChoice: true };
  }
  if (kind === 'recovered-sermon-church') {
    const words = (value: unknown) => churchFieldWords(value) ?? t('calendar.unspecifiedChurch');
    return { identity, valueKind: 'field', title: fieldLabel(t, 'church'),
      mine: words(comparison.mine.value), stored: words(comparison.stored.value), scopedChoice: true,
      ...(comparison.fillsPlannedEntry && { description: t('dataSync.churchChoiceFillsPlannedEntry') }) };
  }
  if (kind === 'recovered-sermon-text') {
    const text = (value: unknown) => typeof value === 'string' && value ? value : t('dataSync.emptyField');
    return { identity, valueKind: 'field', title: fieldLabel(t, comparison.field),
      mine: text(comparison.mine.value), stored: text(comparison.stored.value), scopedChoice: true };
  }
  if (kind === 'preparation-confirmation') {
    const format = (checked: boolean) => t(checked ? 'common.confirmationChecked' : 'common.confirmationUnchecked');
    return { identity, valueKind: 'field', title: fieldLabel(t, comparison.field),
      mine: format(comparison.mine), stored: format(comparison.stored), scopedChoice: true };
  }
  if (kind === 'exegetical-point') {
    const title = (value: string | null) => value === null ? t('dataSync.exegeticalPointRemoved') : value || t('dataSync.emptyField');
    const versions = { identity, valueKind: 'field' as const, title: t('dataSync.exegeticalPointTitle'),
      mine: comparison.versions.map(version => [title(version.mine), ...version.descendantTitles.map(child => '↳ ' + title(child))].join('\n')).join('\n'),
      stored: comparison.versions.map(version => version.pendingAddition ? t('dataSync.exegeticalPointNotSaved') : title(version.stored)).join('\n'),
      keepMineDisabled: !comparison.localAvailable };
    if (!comparison.scoped) {
      return { ...versions, description: t('dataSync.exegeticalPointMultipleConflicts'),
        actions: { local: t('dataSync.useLocalVersion'), stored: t('dataSync.useStoredVersion'), confirmStored: 'common.discardChanges' } };
    }
    const [version] = comparison.versions;
    return { ...versions, scopedChoice: true, actions: {
        local: t(version.mine === null ? 'dataSync.exegeticalPointRemove' : 'dataSync.exegeticalPointKeepMine'),
        stored: t(version.pendingAddition ? 'dataSync.useStoredVersion'
          : version.stored === null ? 'dataSync.exegeticalPointRemove' : 'dataSync.exegeticalPointKeepSaved'),
        ...(version.stored === null && !version.pendingAddition && { confirmStored: 'dataSync.confirmStoredPointRemoval' }),
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
