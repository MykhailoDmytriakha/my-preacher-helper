'use client';

import { useId } from 'react';

import Select from '@/components/ui/Select';
import { useTranslation } from '@locales/useTranslation';

export interface SavedDraftCopyOption {
  key: string;
  label: string;
}

export interface SavedDraftCopyPickerProps {
  options: readonly SavedDraftCopyOption[];
  selectedKey: string | null;
  onChange: (key: string) => void;
  disabled?: boolean;
  className?: string;
}

const optionLabel = (label: string): string => {
  const characters = Array.from(label);
  return characters.length > 120 ? `${characters.slice(0, 119).join('')}…` : label;
};

export default function SavedDraftCopyPicker({
  options,
  selectedKey,
  onChange,
  disabled = false,
  className,
}: SavedDraftCopyPickerProps) {
  const id = useId();
  const { t } = useTranslation();

  if (options.length < 2) return null;

  const optionKeys = new Set(options.map((option) => option.key));

  return (
    <label htmlFor={id} className={className}>
      {t('unsavedDraft.chooseCopy')}
      <Select
        id={id}
        value={selectedKey ?? options[0].key}
        disabled={disabled}
        onChange={(event) => {
          const key = event.currentTarget.value;
          if (optionKeys.has(key)) onChange(key);
        }}
      >
        {options.map((option, index) => (
          <option key={option.key} value={option.key}>
            {index + 1}. {optionLabel(option.label)}
          </option>
        ))}
      </Select>
    </label>
  );
}
