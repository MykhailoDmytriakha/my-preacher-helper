import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isVisualSectionKey } from '@/utils/sermonVisualOrder';

import { OutlinePointOptions, type OutlinePointGroups } from './OutlinePointOptions';

import type { SermonOutline } from '@/models/models';

interface ThoughtOutlineFieldProps {
  sermonOutline?: SermonOutline;
  section?: string;
  outlinePointId?: string | null;
  subPointId?: string | null;
  onSelect: (outlinePointId: string | null, subPointId: string | null) => void;
  disabled?: boolean;
}

function filterPoints(outline: SermonOutline | undefined, section?: string): OutlinePointGroups {
  if (!outline) return {};
  if (isVisualSectionKey(section) && section !== 'ambiguous') {
    return Array.isArray(outline[section]) ? { [section]: outline[section] } : {};
  }
  return {
    introduction: Array.isArray(outline.introduction) ? outline.introduction : [],
    main: Array.isArray(outline.main) ? outline.main : [],
    conclusion: Array.isArray(outline.conclusion) ? outline.conclusion : [],
  };
}

/** Choosing a location updates the editor draft; no write or acceptance policy lives here. */
export function ThoughtOutlineField({ sermonOutline, section, outlinePointId, subPointId, onSelect, disabled = false }: ThoughtOutlineFieldProps) {
  const { t } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const groups = filterPoints(sermonOutline, section);
  const point = outlinePointId ? Object.values(groups).flat().find(candidate => candidate?.id === outlinePointId) : undefined;
  const subPoint = point?.subPoints?.find(candidate => candidate.id === subPointId);
  const label = point ? (subPoint ? `${point.text} / ${subPoint.text}` : point.text) : t('editThought.noSermonPoint');
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', dismiss);
    return () => document.removeEventListener('mousedown', dismiss);
  }, [open]);
  return <div className="mb-2" ref={ref}>
    <label htmlFor={id} className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('editThought.outlinePointLabel')}</label>
    <div className="relative">
      <button id={id} type="button" disabled={disabled} aria-expanded={open} onClick={() => setOpen(current => !current)}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border p-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${point
          ? 'border-blue-200 bg-blue-50/50 text-gray-800 dark:border-blue-800 dark:bg-blue-900/30 dark:text-gray-200'
          : 'border-gray-300 text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-400'} hover:border-blue-300 dark:hover:border-blue-700`}>
        <span className="truncate text-sm">{label}</span><ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
        <OutlinePointOptions groups={groups} outlinePointId={outlinePointId} subPointId={subPointId} disabled={disabled}
          onSelect={(pointId, subId) => { if (!disabled) { onSelect(pointId, subId); setOpen(false); } }} />
      </div>}
    </div>
  </div>;
}
