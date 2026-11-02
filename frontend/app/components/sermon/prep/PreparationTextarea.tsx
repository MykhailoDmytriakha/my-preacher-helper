'use client';

import { Check, X } from 'lucide-react';

import { useBufferedText } from '@/components/ui/useBufferedText';
import { DataSyncStatus, SyncOutlet } from '@/data-engine/DataSyncStatus';
import { usePreparationFieldOpening } from '@/hooks/usePreparationFieldOpening';
import { UI_COLORS } from '@/utils/themeColors';
import { useTranslation } from '@locales/useTranslation';

import type { PreparationFieldBinding, PreparationTextBinding } from '@/components/common/manualTextBinding';

interface Props { binding: PreparationTextBinding; placeholder: string; rows?: number; singleLine?: boolean; autoSize?: boolean; actionsInline?: boolean; id?: string; label?: string; saveLabelKey?: string; cancelLabelKey?: string }
/** Only immediate render echoes are buffered here; every keystroke is staged by the binding. */
function Input({ binding, placeholder, rows = 3, singleLine = false, id, label, saveLabelKey = 'actions.save', cancelLabelKey = 'actions.cancel', autoSize = false, actionsInline = false }: Props) {
  usePreparationFieldOpening(binding);
  const text = useBufferedText(binding.value, binding.update);
  const dirty = binding.dirty || text.draft !== binding.value;
  const Control = singleLine ? 'input' : 'textarea';
  return <>
    <div className={actionsInline ? 'flex flex-col sm:flex-row gap-2' : undefined}>
    <Control ref={(element: HTMLInputElement | HTMLTextAreaElement | null) => { if (autoSize && element) { element.style.height = 'auto'; element.style.height = `${element.scrollHeight}px`; } }} id={id} aria-label={label} type={singleLine ? 'text' : undefined} rows={singleLine ? undefined : rows} value={text.draft} onChange={event => text.change(event.target.value)}
      placeholder={placeholder} disabled={!binding.ready}
      className={`${actionsInline ? 'flex-1' : 'w-full'} ${autoSize ? 'resize-y max-h-80' : ''} rounded-md border px-3 py-2 bg-white dark:bg-gray-800 ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} focus:outline-none focus:ring-2 focus:ring-offset-0`} />
    <PreparationFieldActions binding={binding} value={text.draft} dirty={dirty} inline={actionsInline}
      saveLabelKey={saveLabelKey} cancelLabelKey={cancelLabelKey} />
    </div>
    <PreparationFieldStatus binding={binding} />
  </>;
}
export function PreparationTextarea(props: Props) {
  return <Input key={props.binding.subject} {...props} />;
}

export function PreparationFieldStatus<T>({ binding }: { binding: PreparationFieldBinding<T> }) {
  return <>
    <SyncOutlet subject={binding.decision?.subject} active={Boolean(binding.decision)} />
    <DataSyncStatus subject={binding.subject} status={null} error={binding.error} onRetry={binding.retry}
      recoveryChoices={binding.recovery.choices} recoveryLoading={binding.recovery.loading}
      recoveryError={binding.recovery.error} onRecover={binding.recovery.recover} onDiscardRecovery={binding.recovery.discard} />
  </>;
}

export function PreparationFieldActions<T>({ binding, value, dirty = binding.dirty, inline = false,
  saveLabelKey = 'actions.save', cancelLabelKey = 'actions.cancel' }: {
  binding: PreparationFieldBinding<T>; value: T; dirty?: boolean; inline?: boolean; saveLabelKey?: string; cancelLabelKey?: string;
}) {
  const { t } = useTranslation();
  return <>
    {dirty && <div className={`${inline ? '' : 'mt-2'} flex items-center justify-end gap-2`}>
      <button type="button" onClick={() => { void binding.save(value).catch(() => undefined); }} disabled={binding.busy || binding.canSave === false}
        className={`inline-flex items-center justify-center px-3 py-1.5 rounded-md text-xs font-semibold shadow-sm ${UI_COLORS.button.primary.bg} ${UI_COLORS.button.primary.hover} dark:${UI_COLORS.button.primary.darkBg} dark:${UI_COLORS.button.primary.darkHover} ${UI_COLORS.button.primary.text}`}
        title={t(saveLabelKey)}><Check className="w-4 h-4" /></button>
      <button type="button" onClick={() => { void binding.cancel().catch(() => undefined); }}
        className={`inline-flex items-center justify-center px-3 py-1.5 rounded-md text-xs font-medium border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}
        title={t(cancelLabelKey)}><X className="w-4 h-4" /></button>
    </div>}
  </>;
}
