'use client';

import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { PlusIcon } from '@heroicons/react/20/solid';
import { useState } from 'react';


import { BuiltSermonsList } from '@/components/sermon/BuiltSermonsList';
import { EngineCreateSermonModal } from '@/components/sermon/EngineCreateSermonModal';
import { useEngineSermonsBuiltOnNote } from '@/hooks/useSermonNoteLinks';
import { documentScreenHref } from '@/utils/documentScreenHref';
import { NOTE_TO_SERMON_COLORS } from '@/utils/themeColors';
import { useTranslation } from '@locales/useTranslation';

import { USAGE_KIND_LOOK } from '../usageKinds';

import { AnalysisPlaceChip } from './AnalysisPlaceChip';

import type { Sermon } from '@/models/models';
import type { ReactNode } from 'react';

/** Over the reader's windows and the analysis page (z-[120]). */
const NEW_SERMON_LAYER = 'z-[130]';
const CAPSULE = 'inline-flex h-8 max-w-[14rem] shrink-0 items-center gap-1.5 rounded-full border text-[13px] font-semibold transition-[filter] hover:brightness-95 active:brightness-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400';

type AnalysisSermonsProps = {
  /** The analysis's note: only a kept analysis can be named by a sermon. */
  noteId: string;
  /** Its passage in words, «Еф 1:3–14». */
  place: string;
  /** The new sermon's verse: the passage as the reader's «Копировать» gives it, the place and all its words (`passageCopyText`). */
  verse: string;
  /** Opens a screen of the app, the reader's way (the trail keeps the way back). */
  onOpen: (href: string) => void;
};

/**
 * AN ANALYSIS'S SERMONS (case 2026-10-12-block-diagram, phase 7, case 1; the owner's choice 30.10 on the canvas «Путь в
 * Библию», board «Случай 1»): the sermons whose `sourceNoteIds` name the analysis, read from the engine's list, and the
 * door to a new one — the app's own «Новая проповедь» with the passage written in full, as if copied from the Bible and
 * pasted (the owner, 31.10), and the analysis linked. From the Bible only a new sermon is made; an analysis is added to
 * a sermon there is from the sermon (case 2). After «Сохранить» the person stays where they read. Two looks of it:
 * capsules in the reader sheet, a compact header menu, and a side-panel list.
 */
function useAnalysisSermons({ noteId, place, verse }: Omit<AnalysisSermonsProps, 'onOpen'>) {
  const { t } = useTranslation();
  const sermons = useEngineSermonsBuiltOnNote(noteId);
  const [creating, setCreating] = useState(false);
  const dialog = creating ? (
    <EngineCreateSermonModal
      initialVerse={verse || place}
      sourceNoteIds={[noteId]}
      layerClassName={NEW_SERMON_LAYER}
      verseNote={(
        <p className="mt-2.5 flex flex-wrap items-center gap-2 text-[13px] text-gray-600 dark:text-gray-300">
          <AnalysisPlaceChip place={place} />
          {t('analysis.sermon.linked')}
        </p>
      )}
      onClose={() => setCreating(false)}
      onQueued={() => setCreating(false)}
    />
  ) : null;
  return { sermons, create: () => setCreating(true), dialog };
}

const titleOf = (sermon: Sermon, untitled: string) => sermon.title?.trim() || untitled;

function AnalysisSermonList({ sermons, onOpen, onCreate, createLabel, testId, children }: {
  sermons: Sermon[]; onOpen: AnalysisSermonsProps['onOpen']; onCreate: () => void;
  createLabel?: string; testId: string; children?: ReactNode;
}) {
  const { t } = useTranslation();
  const untitled = t('analysis.sermon.untitled');
  return (
    <BuiltSermonsList
      testId={testId}
      title={t('analysis.sermon.title')}
      sermons={sermons.map((sermon) => ({ ...sermon, title: titleOf(sermon, untitled) }))}
      empty={t('analysis.sermon.empty')}
      openLabel={(title) => t('analysis.sermon.open', { title })}
      onOpen={onOpen}
    >
      <button type="button" onClick={onCreate} aria-label={createLabel}
        className={`flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${NOTE_TO_SERMON_COLORS.openerButton}`}>
        <PlusIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{t('analysis.sermon.create')}</span>
      </button>
      {children}
    </BuiltSermonsList>
  );
}

function SermonCircle() {
  const { Icon, badge } = USAGE_KIND_LOOK.sermon;
  return (
    <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${badge.circle}`}>
      <Icon className="h-3 w-3 text-white" aria-hidden="true" />
    </span>
  );
}

/**
 * In the reader's analysis badge sheet: one small capsule in the
 * sermon's own colour and sign, the look of its badges on the text (`usageKinds.ts`). «Проповедь +» while none is made
 * from it; then each sermon a capsule with its title that opens it, and «+» beside for another.
 */
export function AnalysisSermons(props: AnalysisSermonsProps) {
  const { t } = useTranslation();
  const { place, onOpen } = props;
  const { sermons, create, dialog } = useAnalysisSermons(props);
  const { badge } = USAGE_KIND_LOOK.sermon;
  const newLabel = t('analysis.sermon.newAria', { place });
  const another = t('analysis.sermon.another', { place });
  return (
    // Several sermons wrap within the window rather than push its close button out (three long titles: the owner's 31.10).
    <span className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-1.5" data-testid="analysis-sermons">
      {sermons.length === 0 ? (
        <button type="button" onClick={create} aria-label={newLabel} title={newLabel}
          className={`${CAPSULE} ${badge.capsule} pl-[3px] pr-2.5`}>
          <SermonCircle />{t('analysis.sermon.new')}<PlusIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
        </button>
      ) : (
        <>
          {sermons.map((sermon) => {
            const title = titleOf(sermon, t('analysis.sermon.untitled'));
            const open = t('analysis.sermon.open', { title });
            const href = documentScreenHref({ collection: 'sermons', id: sermon.id });
            return (
              <button key={sermon.id} type="button" onClick={() => { if (href) onOpen(href); }} aria-label={open} title={title}
                className={`${CAPSULE} ${badge.capsule} pl-[3px] pr-3`}>
                <SermonCircle /><span className="truncate">{title}</span>
              </button>
            );
          })}
          <button type="button" onClick={create} aria-label={another} title={another}
            className={`${CAPSULE} ${badge.capsule} w-8 justify-center`}>
            <PlusIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        </>
      )}
      {dialog}
    </span>
  );
}

/** The analysis header keeps one action in the row, however many sermons are linked. */
export function AnalysisSermonsMenu(props: AnalysisSermonsProps) {
  const { t } = useTranslation();
  const { place, onOpen } = props;
  const { sermons, create, dialog } = useAnalysisSermons(props);
  const { badge } = USAGE_KIND_LOOK.sermon;
  const newLabel = t('analysis.sermon.newAria', { place });
  const label = t('analysis.sermon.openList', { count: sermons.length });
  return (
    <div className="inline-flex shrink-0" data-testid="analysis-sermons">
      {sermons.length === 0 ? (
        <button type="button" onClick={create} aria-label={newLabel} title={newLabel}
          className={`${CAPSULE} ${badge.capsule} px-1.5 sm:pr-2.5 max-sm:h-11`}>
          <SermonCircle /><span className="hidden min-[360px]:inline">{t('analysis.sermon.new')}</span><PlusIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
        </button>
      ) : (
        <Popover>
          <PopoverButton aria-label={label} data-testid="analysis-sermons-trigger"
            className={`${CAPSULE} ${badge.capsule} px-2 max-sm:h-11`}>
            <span className="inline-flex items-center gap-1 min-[360px]:hidden" aria-hidden="true"><SermonCircle />{sermons.length}</span>
            <span className="hidden whitespace-nowrap min-[360px]:inline">{label}</span>
          </PopoverButton>
          <PopoverPanel focus className="absolute right-2 top-full z-20 mt-1 max-h-[min(24rem,calc(100dvh-8rem))] w-[min(20rem,calc(100vw-1rem))] overflow-auto overscroll-contain rounded-xl border border-gray-200 bg-white p-3 shadow-xl dark:border-gray-700 dark:bg-gray-900">
            {({ close }) => (
              <AnalysisSermonList
                testId="analysis-sermons-list"
                sermons={sermons}
                onOpen={(href) => { close(); onOpen(href); }}
                onCreate={() => { close(); create(); }}
                createLabel={t('analysis.sermon.another', { place })}
              />
            )}
          </PopoverPanel>
        </Popover>
      )}
      {dialog}
    </div>
  );
}

/**
 * In the analysis page's side panel, under the mode's help (the owner, 31.10: three sermons' capsules crowded the
 * page's header — «нужно это сюда, в правую колонку… сразу секция проповеди»): the list a study note's page shows of
 * its sermons (`BuiltSermonsList`), and the door to a new one under it.
 */
export function AnalysisSermonsPanel(props: AnalysisSermonsProps) {
  const { sermons, create, dialog } = useAnalysisSermons(props);
  return (
    <AnalysisSermonList testId="analysis-sermons-panel" sermons={sermons} onOpen={props.onOpen} onCreate={create}>
      {dialog}
    </AnalysisSermonList>
  );
}
