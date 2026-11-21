import { anchoredStepComparison } from '@/components/care/serviceOrderPlacementWords';
import { readCouncilSummaryChoice, readCouncilTopicConflict, readCouncilTopicTextComparison, readPrivateCouncilComparison, readUnreadableScalarComparison } from '@/data-engine/react.client';
import { formatDateTimeForLocale } from '@/utils/dateFormatter';
import { shownDayOf } from '@/utils/dateOnly';

import { councilOutcomeWords } from './councilOutcomeWords';

import type { TextComparison } from '@/data-engine/DataSyncStatus';
import type { SessionCheckpoint } from '@/data-engine/session';
import type { CouncilTopic } from '@/models/models';
import type { TFunction } from 'i18next';

export function councilLifecycleWords(value: string | null, t: TFunction, language: string): string {
  return value ? t('council.history.heldOn', { when: formatDateTimeForLocale(value, language) }) : t('council.status.preparing');
}

export function councilTopicComparison(checkpoint: SessionCheckpoint | undefined, t: TFunction, language: string,
  topics?: readonly CouncilTopic[]): TextComparison | undefined {
  const placement = checkpoint?.confirmed.resource.collection === 'councils' && anchoredStepComparison(checkpoint, 'council.detail.sectionPosition', t);
  if (placement) return placement;
  const nested = checkpoint && readCouncilTopicTextComparison(checkpoint);
  if (nested && 'complete' in nested) {
    return { identity: nested.identity, mine: '', stored: '', valueKind: 'field', scopedChoice: true, completeReview: true };
  }
  if (nested?.field === 'kind') {
    const label = (value: typeof nested.mine) => t(value === 'info' ? 'council.topic.kindInfo' : 'council.topic.kindDecision');
    return { identity: nested.identity, title: t('council.topic.kind'), valueKind: 'field', scopedChoice: true,
      mine: label(nested.mine), stored: label(nested.stored) };
  }
  if (nested?.field === 'assembly') {
    const label = (value: boolean) => t(value ? 'council.assemblyHistory.marked' : 'council.assemblyHistory.unmarked');
    return { identity: nested.identity, title: t('council.topic.forAssembly'), valueKind: 'field', scopedChoice: true,
      mine: label(nested.mine), stored: label(nested.stored) };
  }
  if (nested?.field === 'outcome') {
    const topic = topics?.find(item => item.id === nested.birth);
    return { identity: nested.identity, title: t('council.topic.atCouncil'), valueKind: 'field', scopedChoice: true,
      ...(!nested.localAvailable && { keepMineDisabled: true, description: t('council.topic.optionGone') }),
      mine: councilOutcomeWords(nested.mine, topic, t), stored: councilOutcomeWords(nested.stored, topic, t) };
  }
  if (nested) {
    const version = (value: string | null) => {
      if (nested.field === 'council-lifecycle') return councilLifecycleWords(value, t, language);
      if (nested.field === 'council-date') return value ? shownDayOf(value) : t('council.noDate');
      return value || t('dataSync.emptyField');
    };
    const labels = { question: 'council.topic.questionPlaceholder', answer: 'council.topic.answerPlaceholder',
      option: 'council.topic.optionPlaceholder', summary: 'council.topic.summary', 'topic-title': 'council.detail.newTopicPlaceholder',
      'council-title': 'council.detail.titleLabel', 'council-date': 'council.detail.dateLabel', 'council-lifecycle': 'council.history.lifecycle' };
    return { identity: nested.identity, title: t(labels[nested.field]), valueKind: 'field', scopedChoice: true,
      ...(nested.removed && { keepMineDisabled: true, valueKind: 'removed-row' as const }),
      mine: version(nested.mine), stored: version(nested.stored) };
  }
  const privateField = checkpoint && readPrivateCouncilComparison(checkpoint);
  const summary = privateField?.field === 'summary' ? privateField : checkpoint && readCouncilSummaryChoice(checkpoint);
  if (summary) return { identity: summary.identity, title: t('council.topic.summary'), valueKind: 'field', scopedChoice: true,
    mine: summary.mine || t('dataSync.emptyField'), stored: summary.stored || t('dataSync.emptyField') };
  if (privateField?.field === 'outcome') {
    const topic = topics?.find(item => item.id === privateField.birth);
    return { identity: privateField.identity, title: t('council.topic.atCouncil'), valueKind: 'field', scopedChoice: true,
      ...(privateField.localAvailable === false && { keepMineDisabled: true, description: t('council.topic.optionGone') }),
      mine: councilOutcomeWords(privateField.mine, topic, t), stored: councilOutcomeWords(privateField.stored, topic, t) };
  }
  if (privateField?.field === 'topic-title') {
    const untitled = t('council.topicTitleHistory.untitled');
    return { identity: privateField.identity, title: t('council.detail.newTopicPlaceholder'), valueKind: 'field', scopedChoice: true,
      mine: privateField.mine || untitled, stored: privateField.stored || untitled };
  }
  const unreadable = privateField ?? (checkpoint && readUnreadableScalarComparison(checkpoint));
  if (unreadable && unreadable.field !== 'status' && unreadable.field !== 'summary') {
    const label = unreadable.field === 'title' ? 'council.detail.titleLabel'
      : unreadable.field === 'date' ? 'council.detail.dateLabel' : 'council.history.lifecycle';
    return { identity: unreadable.identity, title: t(label), valueKind: 'field', scopedChoice: true,
      mine: unreadable.field === 'heldAt' ? councilLifecycleWords(unreadable.mine, t, language) : unreadable.mine || t('dataSync.emptyField'),
      stored: unreadable.field === 'heldAt' ? councilLifecycleWords(unreadable.stored, t, language) : unreadable.stored || t('dataSync.emptyField') };
  }
  const comparison = checkpoint && readCouncilTopicConflict(checkpoint);
  if (!comparison) return undefined;
  const { field, mine, stored, identity } = comparison;
  const scope = { identity, valueKind: 'field' as const, scopedChoice: true as const };
  if (field === 'outcome') {
    const topic = topics?.find(item => item.id === comparison.rowId);
    return { ...scope, title: t('council.topic.atCouncil'), mine: councilOutcomeWords(mine, topic, t), stored: councilOutcomeWords(stored, topic, t) };
  }
  if (field === 'title') {
    const untitled = t('council.topicTitleHistory.untitled');
    return { ...scope, title: t('council.detail.newTopicPlaceholder'), mine: mine || untitled, stored: stored || untitled };
  }
  if (field === 'kind') {
    const label = (value: typeof mine) => t(value === 'info' ? 'council.topic.kindInfo' : 'council.topic.kindDecision');
    return { ...scope, title: t('council.topic.kind'), mine: label(mine), stored: label(stored) };
  }
  const label = (value: boolean) => t(value ? 'council.assemblyHistory.marked' : 'council.assemblyHistory.unmarked');
  return { ...scope, title: t('council.topic.forAssembly'), mine: label(mine), stored: label(stored) };
}
