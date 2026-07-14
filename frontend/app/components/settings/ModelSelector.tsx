'use client';

import { MicrophoneIcon, PencilSquareIcon, SpeakerWaveIcon } from '@heroicons/react/24/outline';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { aiFunctionIds, getFunctionCatalog } from '@/api/clients/ai/functionCatalog';
import { useUserEntitlement } from '@/hooks/useUserEntitlement';
import { useUserSettings } from '@/hooks/useUserSettings';

import type { AiFunctionId, FunctionCatalogEntry } from '@/api/clients/ai/functionCatalog';
import type { User } from 'firebase/auth';

interface ModelSelectorProps {
  user: User | null;
}

const preferenceField: Record<AiFunctionId, 'preferredTranscription' | 'preferredText' | 'preferredTts'> = {
  text: 'preferredText',
  transcription: 'preferredTranscription',
  tts: 'preferredTts',
};

const functionIcon: Record<AiFunctionId, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  text: PencilSquareIcon,
  transcription: MicrophoneIcon,
  tts: SpeakerWaveIcon,
};

const sameTarget = (
  left: { providerId: string; modelId: string } | undefined,
  right: Pick<FunctionCatalogEntry, 'providerId' | 'modelId'>
): boolean => left?.providerId === right.providerId && left.modelId === right.modelId;

function ProviderLabel({ providerId }: { providerId: FunctionCatalogEntry['providerId'] }) {
  const { t } = useTranslation();
  const label = providerId === 'openai'
    ? t('settings.modelSelector.providers.openai')
    : providerId === 'openrouter'
      ? t('settings.modelSelector.providers.openrouter')
      : t('settings.modelSelector.providers.gemini');

  return <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10.5px] text-slate-500 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">{label}</span>;
}

/** Five fixed segments keep Tailwind's generated CSS independent of runtime data. */
function MiniBar({ value, kind }: { value: 1 | 2 | 3 | 4 | 5; kind: 'quality' | 'cost' }) {
  const fill = (segment: number) => {
    if (kind === 'quality') {
      if (value >= segment) return 'h-1.5 w-3 rounded-sm bg-blue-600 dark:bg-blue-400';
      return 'h-1.5 w-3 rounded-sm bg-slate-200 dark:bg-slate-700';
    }
    if (value >= segment) return 'h-1.5 w-3 rounded-sm bg-amber-500 dark:bg-amber-400';
    return 'h-1.5 w-3 rounded-sm bg-slate-200 dark:bg-slate-700';
  };

  return (
    <span className="inline-flex gap-0.5" aria-hidden="true" data-testid={`${kind}-bar`}>
      <i className={fill(1)} />
      <i className={fill(2)} />
      <i className={fill(3)} />
      <i className={fill(4)} />
      <i className={fill(5)} />
    </span>
  );
}

export default function ModelSelector({ user }: ModelSelectorProps) {
  const { t } = useTranslation();
  const { data: entitlement, isLoading: entitlementLoading, isError: entitlementError } = useUserEntitlement(user);
  const { updateFunctionModelPreference, updatingFunctionModelPreference } = useUserSettings(user?.uid);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (!user) return null;

  if (entitlementLoading) {
    return <div className="rounded-[14px] bg-white p-4 shadow-sm dark:bg-slate-800 md:p-6" data-testid="model-selector-loading"><div className="animate-pulse"><div className="h-5 w-1/3 rounded bg-slate-200 dark:bg-slate-700" /><div className="mt-3 h-4 w-2/3 rounded bg-slate-200 dark:bg-slate-700" /></div></div>;
  }

  if (entitlementError || !entitlement) {
    return <div className="rounded-[14px] bg-white p-4 shadow-sm dark:bg-slate-800 md:p-6"><p className="text-sm text-red-600 dark:text-red-400" role="alert">{t('settings.modelSelector.loadError')}</p></div>;
  }

  // A persisted/stale React Query cache written before this feature can hydrate an old
  // entitlement shape without `functions`; render loading until the fresh fetch repopulates
  // the new shape instead of crashing on `entitlement.functions[fn]`.
  if (!entitlement.functions) {
    return <div className="rounded-[14px] bg-white p-4 shadow-sm dark:bg-slate-800 md:p-6" data-testid="model-selector-loading"><div className="animate-pulse"><div className="h-5 w-1/3 rounded bg-slate-200 dark:bg-slate-700" /><div className="mt-3 h-4 w-2/3 rounded bg-slate-200 dark:bg-slate-700" /></div></div>;
  }

  const isFree = entitlement.effectiveTier === 'free';
  const handleSelect = async (fn: AiFunctionId, model: FunctionCatalogEntry) => {
    const current = entitlement.functions[fn].current;
    if (isFree || sameTarget(current, model) || updatingFunctionModelPreference) return;

    setSaveError(null);
    try {
      await updateFunctionModelPreference({
        [preferenceField[fn]]: { providerId: model.providerId, modelId: model.modelId },
      });
    } catch {
      setSaveError(t('settings.modelSelector.saveError'));
    }
  };

  return (
    <section className="rounded-[14px] bg-white p-4 shadow-sm dark:bg-slate-800 md:p-6" aria-labelledby="model-selector-title">
      <div>
        <div>
          <h2 id="model-selector-title" className="text-lg font-semibold text-slate-900 dark:text-white">{t('settings.modelSelector.title')}</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t('settings.modelSelector.description')}</p>
        </div>
      </div>

      <div className="mt-4 space-y-5">
        {aiFunctionIds.map((fn) => {
          const current = entitlement.functions[fn].current;
          const allowed = entitlement.functions[fn].available;
          const FunctionIcon = functionIcon[fn];
          return (
            <div key={fn}>
              <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white"><FunctionIcon aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-slate-500 dark:text-slate-400" />{t(`settings.modelSelector.functions.${fn}.title`)}</h3>
              <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">{t(`settings.modelSelector.functions.${fn}.description`)}</p>
              <div className="mt-2 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
                {getFunctionCatalog(fn).map((model, index) => {
                  const selected = sameTarget(current, model);
                  const selectable = allowed.some((entry) => sameTarget(entry, model));
                  const locked = !selectable;
                  const inputId = `model-${fn}-${model.providerId}-${model.modelId}`;
                  return (
                    <label key={inputId} htmlFor={inputId} className={`flex items-center gap-3 px-3 py-3 ${index > 0 ? 'border-t border-slate-100 dark:border-slate-700' : ''} ${locked ? 'cursor-default opacity-50' : 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/40'}`}>
                      <input id={inputId} type="radio" name={`preferred-${fn}`} checked={selected} disabled={locked || updatingFunctionModelPreference} onChange={() => void handleSelect(fn, model)} className="peer sr-only" />
                      <span data-testid={selected ? 'selected-radio-indicator' : undefined} aria-hidden="true" className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-slate-400 bg-white peer-checked:border-blue-600 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500 peer-focus-visible:ring-offset-2 peer-disabled:border-slate-300 dark:border-slate-500 dark:bg-slate-800 dark:peer-checked:border-blue-400 dark:peer-disabled:border-slate-600 dark:peer-focus-visible:ring-offset-slate-800">
                        {selected && <span className="h-2 w-2 rounded-full bg-blue-600 dark:bg-blue-400" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2"><span className="break-all text-sm font-semibold text-slate-900 dark:text-slate-100">{model.modelId}</span><ProviderLabel providerId={model.providerId} /></span>
                        <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500"><span>{t('settings.modelSelector.quality')}</span><MiniBar value={model.quality} kind="quality" /><span>{t('settings.modelSelector.cost')}</span><MiniBar value={model.cost} kind="cost" /></span>
                      </span>
                      {selected && <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[10.5px] font-bold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">{t('settings.modelSelector.current')}</span>}
                      {locked && <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10.5px] font-bold text-slate-500 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">{t('settings.modelSelector.paidLocked')}</span>}
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {isFree && <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">{t('settings.modelSelector.freeHint')}</p>}
      {saveError && <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">{saveError}</p>}
    </section>
  );
}
