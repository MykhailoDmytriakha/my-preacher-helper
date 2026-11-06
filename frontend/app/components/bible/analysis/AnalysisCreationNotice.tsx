'use client';

import { analysisMarkdown, storedAnalysis } from '@/utils/passageAnalysis';
import { useTranslation } from '@locales/useTranslation';


import { AnalysisPreview } from './AnalysisPreview';

import type { useAnalysisNote } from './useAnalysisNote';

type AnalysisNote = ReturnType<typeof useAnalysisNote>;

/** A refused initial creation keeps its own copy while the canonical passage is found or compared. */
export function AnalysisCreationNotice({ note }: { note: AnalysisNote }) {
  const { t } = useTranslation();
  if (!note.duplicateRefusal) return null;
  const waiting = note.combining || !note.creationReview;
  const reviewKey = note.canOpenExistingAnalysis ? 'analysis.creation.review' : 'analysis.notKept';
  return (
    <div role={waiting ? 'status' : 'alert'} className="mb-4 space-y-3 rounded-xl bg-amber-50 px-3 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
      <p>{t(waiting ? 'analysis.creation.combining' : reviewKey)}</p>
      {!waiting ? (
        <>
          <details>
            <summary className="cursor-pointer font-semibold">{t('analysis.creation.compare')}</summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <section className="min-w-0 space-y-2">
                <h3 className="font-semibold">{t('analysis.creation.local')}</h3>
                <AnalysisPreview text={analysisMarkdown(note.words, note.state)} analysis={note.source ? storedAnalysis(note.state, note.source.bible, note.total) : undefined} />
              </section>
              {note.existingAnalysis ? <section className="min-w-0 space-y-2">
                <h3 className="font-semibold">{t('analysis.creation.existing')}</h3>
                <AnalysisPreview text={note.existingAnalysis.content} analysis={note.existingAnalysis.analysis} />
              </section> : null}
            </div>
          </details>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={note.retryCombination} className="rounded-lg bg-white px-3 py-2 font-semibold ring-1 ring-amber-300 dark:bg-amber-950 dark:ring-amber-800">{t(note.canOpenExistingAnalysis ? 'analysis.creation.retry' : 'analysis.saveAgain')}</button>
            {note.existingAnalysis && note.canOpenExistingAnalysis ? <button type="button" onClick={note.openExistingAnalysis} className="rounded-lg px-3 py-2 underline underline-offset-2">{t('analysis.creation.openExisting')}</button> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
