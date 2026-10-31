'use client';

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useStudyNotesEngine } from '@/hooks/useStudyNotesEngine';
import { getLocalizedAbbrev } from '@/utils/bibleBooks';
import { newClientId } from '@/utils/clientId';
import { buildAnalysisReshapePlan } from '@/utils/studyAnalysisReshape';

import { passageSpan } from './useAnalysisNote';

import type { AppLocale } from '@/utils/appLocale';
import type { BibleId } from '@/utils/bibles';
import type { BookText } from '@/utils/bibleText';
import type { PickedPassage } from '@/utils/passagePick';

/** Plan one passage change; report it only after its complete local capture succeeds. */
export function useAnalysisReshape({ text, bookId, bible, locale }: { text: BookText | null; bookId: string; bible: BibleId; locale: AppLocale }) {
  const { t } = useTranslation();
  const engine = useStudyNotesEngine(true);
  return useCallback(async (id: string, next: PickedPassage): Promise<string | null> => {
    const abbrev = getLocalizedAbbrev(bookId, locale);
    const placeOf = (passage: PickedPassage) => `${abbrev} ${passageSpan(passage)}`;
    const plan = buildAnalysisReshapePlan({ sourceId: id, next, text, bookId, bible, notes: engine.notes,
      newId: newClientId, titleFor: passage => t('analysis.title', { place: placeOf(passage) }) });
    if (!plan) return null;
    if (plan.edits.length === 1) {
      const edit = plan.edits[0];
      const submission = engine.updateNote({ id: edit.id, updates: edit.fields,
        expectedBaseline: edit.expected as unknown as Record<string, unknown> });
      // A durable local capture is enough offline; server acceptance has its own sync status.
      if (!submission.capture) throw Object.assign(new Error('Analysis change was not captured'), { code: 'capture-unavailable' });
      await submission.capture;
    } else await engine.reshapeNotes(plan.edits);
    return plan.messages.map(message => {
      const place = placeOf(message.passage);
      return message.kind === 'joined' ? t('analysis.reshape.joined', { place, other: placeOf(message.other) })
        : t(`analysis.reshape.${message.kind}`, { place });
    }).join(' ');
  }, [bible, bookId, engine, locale, t, text]);
}
