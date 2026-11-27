'use client';

import { PlusIcon } from '@heroicons/react/24/outline';
import { useId, useState, type KeyboardEvent, type Ref } from 'react';

import { Chip } from '@/components/ui/Chip';
import { cleanList } from '@/utils/hardQuestions';
import { useTranslation } from '@locales/useTranslation';

import { FIELD, QUIET_BUTTON } from './parts';

/**
 * A LIST OF SHORT ENTRIES TYPED ONE AT A TIME — the other words a question is asked in, the places
 * of Scripture an answer rests on. Each entry is a chip with its own ✕; Enter or «Добавить» keeps
 * what is typed. Commas stay inside an entry on purpose: «1 Кор 11:4, 14» is one place.
 * A repeat is kept once (`cleanList`). `error` says what the list still lacks, under it, in red.
 */
export function ListInput({ label, values, onChange, placeholder, hint, error, inputRef, fieldClassName = FIELD, disabled = false }: {
  label: string; values: readonly string[]; onChange: (next: string[]) => void; placeholder: string; hint?: string; error?: string;
  /** The field's look: the section's on a page form, the app's window field (`FORM_INPUT_CLASS`) inside a window. */
  inputRef?: Ref<HTMLInputElement>; fieldClassName?: string; disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState('');
  const id = useId();
  const add = () => {
    if (!typed.trim()) return;
    onChange(cleanList([...values, typed]));
    setTyped('');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    add();
  };
  return (
    <div>
      <label htmlFor={id} className="text-sm font-semibold text-gray-800 dark:text-gray-200">{label}</label>
      {values.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={label}>
          {values.map((value) => (
            <li key={value}>
              <Chip tone="neutral" size="sm" wrapLabel disabled={disabled}
                onRemove={disabled ? undefined : () => onChange(values.filter((entry) => entry !== value))}
                removeLabel={t('hardQuestions.list.remove', { value })}>
                {value}
              </Chip>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex gap-2">
        <input id={id} ref={inputRef} type="text" value={typed} disabled={disabled} aria-invalid={error ? true : undefined}
          aria-describedby={[error ? `${id}-error` : '', hint ? `${id}-hint` : ''].filter(Boolean).join(' ') || undefined}
          onChange={(event) => setTyped(event.target.value)} onKeyDown={onKeyDown}
          onBlur={add} placeholder={placeholder} className={`${fieldClassName} min-w-0 flex-1`} autoComplete="off" />
        <button type="button" onClick={add} disabled={disabled || !typed.trim()} className={QUIET_BUTTON}>
          <PlusIcon className="h-4 w-4" aria-hidden="true" />
          {t('hardQuestions.list.add')}
        </button>
      </div>
      {error && <p id={`${id}-error`} role="alert" className="mt-1.5 text-sm font-medium text-red-700 dark:text-red-300">{error}</p>}
      {hint && <p id={`${id}-hint`} className="mt-1.5 text-xs text-gray-600 dark:text-gray-400">{hint}</p>}
    </div>
  );
}
