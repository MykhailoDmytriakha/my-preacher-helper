import { useTranslation } from 'react-i18next';

import FormDialog from '@/components/ui/FormDialog';

import type { ReactNode } from 'react';

interface ExportDialogProps {
  format: 'TXT' | 'PDF';
  title: string;
  onClose: () => void;
  isLoading: boolean;
  error?: string;
  controls?: ReactNode;
  children: ReactNode;
  actions: ReactNode;
}

export function ExportDialog({ format, title, onClose, isLoading, error, controls, children, actions }: ExportDialogProps) {
  const { t } = useTranslation();
  return (
    <FormDialog title={title} eyebrow={format} size={format === 'PDF' ? 'wide' : 'standard'} onClose={onClose}>
      <div className="space-y-5 pt-5" data-testid={`export-${format.toLowerCase()}-modal`}>
        {controls}
        <div aria-busy={isLoading} className={`relative min-h-40 max-h-[45dvh] overflow-auto rounded-xl border border-gray-200 p-4 dark:border-gray-700 ${format === 'PDF' ? 'bg-white' : 'bg-gray-50 dark:bg-gray-800/50'}`}>
          {isLoading && <div role="status" className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 dark:bg-gray-800/80">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
            <span className="sr-only">{t('common.loading')}</span>
          </div>}
          {error ? <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p> : children}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">{actions}</div>
      </div>
    </FormDialog>
  );
}
