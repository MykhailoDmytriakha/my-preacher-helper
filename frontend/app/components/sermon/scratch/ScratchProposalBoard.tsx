'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import OutlineBoard from '@/components/plan-editor/OutlineBoard';
import { useAiUsage } from '@/hooks/useAiUsage';
import { useConnection } from '@/providers/ConnectionProvider';
import { composePlanFromScratch } from '@/services/scratch.service';
import { deepCleanUndefined } from '@/utils/deepCleanUndefined';
import { scratchComposeSource } from '@/utils/scratchComposeSource';
import { replaceSermonOutline } from '@/utils/sermonThoughtEdits';

import { appendScratchPlacementToOutline, cloneSermonOutline, collectComposedScratchNoteIds, stripScratchMetadata } from './scratchBoardModel';

import type { useDataForm } from '@/data-engine/react.client';
import type { DocumentData } from '@/data-engine/types';
import type { Sermon, SermonOutline } from '@/models/models';
import type { ScratchPlacement } from '@/utils/scratchPlacementRemap';

const json = (sermon: Sermon) => deepCleanUndefined(sermon) as unknown as DocumentData;
const sections = ['introduction', 'main', 'conclusion'] as const;

/** Proposal UI transforms only its pinned stage. Apply belongs to the parent form. */
export function ScratchProposalBoard({ sermonId, sermon, form, readOnly, valid, onChange }: {
  sermonId: string; sermon: Sermon; form: ReturnType<typeof useDataForm>; readOnly: boolean; valid: boolean;
  onChange: (outline: SermonOutline) => void;
}) {
  const { t } = useTranslation();
  const { isMagicAvailable } = useConnection();
  const { aiBlocked, refresh } = useAiUsage();
  const [notice, setNotice] = useState<string | null>(null);
  const notes = sermon.scratch ?? [];
  const targets = sections.flatMap(section => (sermon.outline?.[section] ?? []).flatMap(point => [
    { label: point.text, value: JSON.stringify({ pointId: point.id }) },
    ...(point.subPoints ?? []).map(sub => ({ label: `${point.text} / ${sub.text}`, value: JSON.stringify({ pointId: point.id, subPointId: sub.id }) })),
  ]));
  const place = (id: string, target: ScratchPlacement | null) => {
    if (readOnly || !target) return;
    void form.update(current => {
      const value = current as unknown as Sermon;
      const note = value.scratch?.find(item => item.id === id);
      const outline = cloneSermonOutline(value.outline);
      if (!note || !appendScratchPlacementToOutline(outline, target, note.text)) throw new Error('The scratch placement target is unavailable');
      return json({ ...replaceSermonOutline(value, outline), scratch: value.scratch!.filter(item => item.id !== id) });
    }).catch(() => undefined);
  };
  const compose = async () => {
    if (readOnly || !valid || !form.durable || !isMagicAvailable || aiBlocked || !notes.length) return;
    setNotice(null);
    try {
      let unplaced = 0;
      await form.propose(async current => {
        const source = current as unknown as Sermon;
        const result = await composePlanFromScratch(sermonId, source.outline,
          (source.scratch ?? []).map(note => note.id), scratchComposeSource(source));
        unplaced = result.unplacedScratchNoteIds.length;
        const consumed = collectComposedScratchNoteIds(result.outline);
        return json({ ...replaceSermonOutline(source, stripScratchMetadata(result.outline)),
          scratch: (source.scratch ?? []).filter(note => !consumed.has(note.id)) });
      });
      setNotice(unplaced ? t('scratch.board.composeUnplaced', { count: unplaced }) : t('scratch.board.proposalReady'));
      void refresh().catch(() => undefined);
    } catch { /* The engine retains the prior stage and exposes the failure. */ }
  };
  return <div className="space-y-4">
    <p className="text-sm text-gray-600 dark:text-gray-300">{t('scratch.board.proposalHelp')}</p>
    {notice && <p role="status">{notice}</p>}
    <OutlineBoard value={sermon.outline ?? { introduction: [], main: [], conclusion: [] }} onChange={onChange}
      directText showNotes isReadOnly={readOnly}
      getPointThoughtCount={id => sermon.thoughts.filter(thought => thought.outlinePointId === id).length}
      getSubPointThoughtCount={id => sermon.thoughts.filter(thought => thought.subPointId === id).length}
      scratch={{ pool: notes, notesById: new Map(notes.map(note => [note.id, note])), placements: {}, onPlace: place,
        onMove: (id, target) => place(id, target), poolEmptyLabel: t('scratch.board.poolEmpty'),
        poolHeader: <button type="button" onClick={() => { void compose(); }}
          disabled={readOnly || !valid || !form.durable || !isMagicAvailable || aiBlocked || !notes.length}
          className="rounded-lg bg-violet-600 px-3 py-2 text-sm text-white disabled:opacity-50">{t('scratch.board.compose')}</button>,
        renderNote: (note, handle, options) => <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
          <span {...handle} className="cursor-grab text-sm" aria-label={t('common.dragToReorder')}>⠿</span>
          <p className="whitespace-pre-wrap text-sm">{note.text}</p>
          {!options?.overlay && <select aria-label={`${t('scratch.card.placeInto')}: ${note.text}`} value="" disabled={readOnly}
            className="w-full rounded border bg-transparent p-1 text-sm"
            onChange={event => { if (event.target.value) place(note.id, JSON.parse(event.target.value) as ScratchPlacement); }}>
            <option value="">{t('scratch.card.placeInto')}</option>
            {targets.map(target => <option key={target.value} value={target.value}>{target.label}</option>)}
          </select>}
        </div>,
      }} />
  </div>;
}
