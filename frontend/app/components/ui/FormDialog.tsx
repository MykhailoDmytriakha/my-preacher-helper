'use client';

import { XMarkIcon } from '@heroicons/react/24/outline';
import { useId, type ReactNode, type ButtonHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { FORM_COLORS } from '@/utils/themeColors';

import Chip from './Chip';

type FormTone = 'blue' | 'emerald' | 'rose';
interface FormDialogProps {
  title: ReactNode;
  eyebrow: string;
  description?: string;
  tone?: FormTone;
  size?: 'standard' | 'compact' | 'wide';
  dismissOnBackdrop?: boolean;
  closeDisabled?: boolean;
  onClose: () => void;
  children: ReactNode;
}

/** Presentation only: submission, draft retention and dismissal belong to the caller. */
export default function FormDialog({ title, eyebrow, description, tone = 'blue', size = 'standard', dismissOnBackdrop = false, closeDisabled = false, onClose, children }: FormDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const descriptionId = useId();
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm sm:px-4"
      onClick={event => { if (dismissOnBackdrop && !closeDisabled && event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}
        className={`flex h-[100dvh] w-full flex-col overflow-hidden border border-gray-200/70 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900 sm:h-auto sm:max-h-[85vh] sm:rounded-2xl ${size === 'compact' ? 'sm:max-w-md' : size === 'wide' ? 'sm:max-w-4xl' : 'sm:max-w-2xl'}`}>
        <div className={`h-1 w-full shrink-0 bg-gradient-to-r ${FORM_COLORS[tone].gradient}`} />
        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Chip tone={tone} size="sm">{eyebrow}</Chip>
              <h2 id={titleId} className="mt-2 break-words text-2xl font-bold text-gray-900 dark:text-gray-100">{title}</h2>
              {description && <p id={descriptionId} className="mt-1 text-sm text-gray-500 dark:text-gray-400">{description}</p>}
            </div>
            <button type="button" onClick={onClose} aria-label={t('common.close')} disabled={closeDisabled}
              className="shrink-0 rounded-xl p-2 text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800">
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>
          {children}
        </div>
      </div>
    </div>, document.body,
  );
}

interface FormButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: FormTone;
  variant?: 'primary' | 'secondary';
}

export function FormButton({ tone = 'blue', variant = 'primary', className = '', ...props }: FormButtonProps) {
  const appearance = variant === 'secondary'
    ? 'border border-gray-200 px-4 text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'
    : `px-5 text-white shadow-sm disabled:opacity-60 ${FORM_COLORS[tone].action}`;
  return <button type="button" className={`inline-flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition ${appearance} ${className}`} {...props} />;
}

interface FormActionsProps {
  onCancel: () => void;
  cancelLabel: string;
  submitLabel: string;
  saving: boolean;
  submitDisabled?: boolean;
  cancelDisabled?: boolean;
  savingLabel?: string;
  tone?: FormTone;
}

export function FormActions({ onCancel, cancelLabel, submitLabel, saving, submitDisabled = false, cancelDisabled = false, savingLabel, tone = 'blue' }: FormActionsProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-end">
      <FormButton variant="secondary" onClick={onCancel} disabled={cancelDisabled}>
        {cancelLabel}
      </FormButton>
      <FormButton type="submit" tone={tone} disabled={saving || submitDisabled} aria-busy={saving}>
        {saving ? savingLabel ?? t('common.saving') : submitLabel}
      </FormButton>
    </div>
  );
}
