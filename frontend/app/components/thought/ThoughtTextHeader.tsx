import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { FocusRecorderButton } from '@/components/FocusRecorderButton';

import type { useTextDictation } from '@/hooks/useTextDictation';

interface ThoughtTextHeaderProps {
  dictation: ReturnType<typeof useTextDictation>;
  available: boolean;
  saving: boolean;
  readOnly?: boolean;
  showDictation?: boolean;
  labelKey?: string;
}

export function ThoughtTextHeader({ dictation, available, saving, readOnly = false, showDictation = true, labelKey = 'editThought.textLabel' }: ThoughtTextHeaderProps) {
  const { t } = useTranslation();
  const disabled = !available || readOnly || dictation.transcriptionBlocked;
  const quotaLabel = dictation.transcriptionBlocked ? t('settings.usage.transcriptionUsageExhausted') : undefined;
  return <div className="flex min-h-[48px] flex-wrap items-center justify-between gap-3">
    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t(labelKey)}</label>
    {showDictation && <div className={`flex items-center gap-2 transition-opacity duration-300 ${disabled ? 'opacity-40 grayscale' : ''}`}
      aria-disabled={disabled} title={!available ? t('errors.magicUnavailable') : quotaLabel}>
      <span className="whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">{t('editThought.appendDictation')}</span>
      <div className="relative flex h-12 w-12 shrink-0 items-center justify-center">
        <FocusRecorderButton size="small" onRecordingComplete={dictation.complete} isProcessing={dictation.isProcessing}
          disabled={saving || disabled} title={quotaLabel} transcriptionError={dictation.error} onRetry={dictation.retry}
          retryCount={dictation.retryCount} maxRetries={dictation.maxRetries} onClearError={dictation.clear}
          onError={message => { toast.error(message); dictation.stopProcessing(); }} />
      </div>
    </div>}
  </div>;
}
