'use client';

import { ListTree, HelpCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import '@locales/i18n';
import { noteScreenHref } from '@/components/bible/analysis/analysisAddress';
import { AnalysisOutline } from '@/components/bible/analysis/AnalysisOutline';
import { AnalysisPlaceChip } from '@/components/bible/analysis/AnalysisPlaceChip';
import { passageOfReference } from '@/components/bible/analysis/useAnalysisNote';
import { passageLabel } from '@/components/bible/useBookUsage';
import { Chip } from '@/components/ui/Chip';
import { useStudyNotesEngine } from '@/hooks/useStudyNotesEngine';
import { resolveAppLocale } from '@/utils/appLocale';
import { getLocalizedAbbrev } from '@/utils/bibleBooks';

import type { StudyNote } from '@/models/models';

type BlockDiagramSectionProps = {
  /** The sermon whose prep this is: the way back from the Bible leads to it. */
  sermonId?: string;
  /** The notes the sermon was made from (`Sermon.sourceNoteIds`); its analyses are those of type 'analysis'. */
  sourceNoteIds?: string[];
};

/** The analyses among the sermon's notes, in the order the sermon names them. */
function useSermonAnalyses(sourceNoteIds: string[]) {
  const engine = useStudyNotesEngine(sourceNoteIds.length > 0);
  const analyses = useMemo(() => {
    const byId = new Map(engine.notes.map((note) => [note.id, note]));
    return sourceNoteIds.flatMap((id) => {
      const note = byId.get(id);
      return note?.type === 'analysis' && note.content ? [note] : [];
    });
  }, [engine.notes, sourceNoteIds]);
  return { analyses, loading: engine.loading };
}

/**
 * THE BLOCK DIAGRAM OF STEP 3 — «Экзегетический план» (case 2026-10-12-block-diagram, phase 7; the owner, 31.10: «пришло
 * время показать эту блочную диаграмму в шаге три»): the analysis of the passage the sermon was made from, drawn as the
 * reader draws it on a verse (`AnalysisOutline`), above the plan built from it. A press opens it in the Bible, and the
 * reader's way back returns here. A sermon with no analysis keeps the note that one is coming: an analysis is added to a
 * sermon from the sermon itself (case 2), and until then this step offers no door that would lead nowhere.
 */
const BlockDiagramSection: React.FC<BlockDiagramSectionProps> = ({ sermonId, sourceNoteIds }) => {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const locale = resolveAppLocale(i18n?.language);
  const ids = useMemo(() => sourceNoteIds ?? [], [sourceNoteIds]);
  const { analyses, loading } = useSermonAnalyses(ids);
  const [showInfo, setShowInfo] = useState(false);

  if (analyses.length > 0) {
    const from = sermonId ? `/sermons/${encodeURIComponent(sermonId)}` : undefined;
    const placeOf = (note: StudyNote) => {
      const reference = note.scriptureRefs[0];
      const passage = passageOfReference(reference);
      return reference && passage ? passageLabel(getLocalizedAbbrev(reference.book, locale), passage) : '';
    };
    return (
      <div className="space-y-2" data-testid="block-diagram-analyses">
        <div className="flex items-center gap-1.5">
          <ListTree className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" aria-hidden="true" />
          <h4 className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">
            {t('wizard.steps.exegeticalPlan.blockDiagram.title')}
          </h4>
        </div>
        {analyses.map((note) => {
          const place = placeOf(note);
          const href = noteScreenHref(note, { locale, from });
          return (
            <div key={note.id} data-testid="block-diagram-analysis">
              {place ? <AnalysisPlaceChip place={place} /> : null}
              <div className="mt-1.5">
                <AnalysisOutline
                  text={note.content}
                  analysis={note.analysis}
                  label={t('bible.mine.openAnalysis', { place })}
                  grow
                  onOpen={() => router.push(href)}
                />
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // The sermon names notes whose kind is not yet read: no placeholder that would flash before the analysis.
  if (loading && ids.length > 0) return null;

  return (
    <div className="p-2.5 rounded-md bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800">
      <div className="flex items-center gap-1.5">
        <ListTree className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
        <h4 className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">
          {t('wizard.steps.exegeticalPlan.blockDiagram.title')}
        </h4>
        <Chip tone="amber" size="xs">
          {t('wizard.steps.exegeticalPlan.blockDiagram.comingSoon')}
        </Chip>
        <button
          type="button"
          onClick={() => setShowInfo(!showInfo)}
          className="ml-auto text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300 transition-colors"
          title={t('wizard.steps.exegeticalPlan.blockDiagram.notAvailableYet') as string}
        >
          <HelpCircle className="w-3.5 h-3.5" />
        </button>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
        {t('wizard.steps.exegeticalPlan.blockDiagram.description')}
      </p>

      {showInfo && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2 pt-2 border-t border-amber-200 dark:border-amber-800">
          {t('wizard.steps.exegeticalPlan.blockDiagram.notAvailableYet')}
        </p>
      )}
    </div>
  );
};

export default BlockDiagramSection;
