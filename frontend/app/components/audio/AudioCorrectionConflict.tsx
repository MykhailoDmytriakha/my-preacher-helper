'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { SpeechCorrectionConflict } from '@/hooks/usePreparedSpeech';

interface Props {
  conflict: SpeechCorrectionConflict; busy: boolean; saveDisabled?: boolean;
  onSave: (index: number) => void; onUseStored: (index: number) => void;
}

/** Read back the exact refused source before the person names a target and a replacement. */
export default function AudioCorrectionConflict({ conflict, busy, saveDisabled, onSave, onUseStored }: Props) {
  const { t } = useTranslation();
  const [target, setTarget] = useState<number | null>(conflict.targetIndex);
  const chunks = conflict.source?.chunks ?? [];
  const selected = target === null ? undefined : chunks[target];
  return (
    <div className="mt-3 space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950/30">
      <p className="font-medium text-amber-900 dark:text-amber-100" role="alert">
        {t('audioExport.correctionConflictTitle', { defaultValue: 'The saved text changed. Your correction is still here.' })}
      </p>
      {!chunks.length ? (
        <p>{t('audioExport.correctionSourceMissing', { defaultValue: 'There is no saved fragment to change. Keep or copy your correction before closing.' })}</p>
      ) : (
        <>
          {conflict.targetIndex === null && (
            <label className="block space-y-1">
              <span>{t('audioExport.correctionChooseTarget', { defaultValue: 'Choose the fragment to change' })}</span>
              <select className="w-full min-w-0 rounded border border-gray-300 bg-white p-2 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                value={target ?? ''} disabled={busy} onChange={event => setTarget(event.target.value === '' ? null : Number(event.target.value))}>
                <option value="">{t('audioExport.correctionTargetPlaceholder', { defaultValue: 'The fragments were prepared again. Select the intended fragment.' })}</option>
                {chunks.map((chunk, index) => <option key={index} value={index}>{index + 1}. {chunk.text.slice(0, 100)}</option>)}
              </select>
            </label>
          )}
          {selected && <div>
            <p className="mb-1 font-medium">{t('audioExport.correctionStoredText', { defaultValue: 'Saved text' })}</p>
            <p className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded bg-white p-2 text-gray-900 dark:bg-gray-900 dark:text-white">{selected.text}</p>
          </div>}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => { if (target !== null) onSave(target); }} disabled={busy || saveDisabled || !selected}
              className="min-w-0 flex-1 rounded-lg bg-orange-600 px-3 py-2 text-white disabled:opacity-50">
              {t('audioExport.correctionSaveMine', { defaultValue: 'Save my text' })}
            </button>
            <button type="button" onClick={() => { if (target !== null) onUseStored(target); }} disabled={busy || !selected}
              className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 disabled:opacity-50 dark:bg-gray-800 dark:text-white">
              {t('audioExport.correctionUseStored', { defaultValue: 'Use saved text' })}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
