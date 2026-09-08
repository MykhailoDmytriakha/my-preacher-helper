import { useTranslation } from 'react-i18next';

import { sortSubPointsByPosition } from '@/utils/subPoints';

import type { SermonOutline } from '@/models/models';

export type OutlinePointGroups = Partial<Pick<SermonOutline, 'introduction' | 'main' | 'conclusion'>>;
interface OutlinePointOptionsProps {
  groups: OutlinePointGroups;
  outlinePointId?: string | null;
  subPointId?: string | null;
  onSelect: (outlinePointId: string | null, subPointId: string | null) => void;
  disabled?: boolean;
  allowClear?: boolean;
}

const optionClass = (selected: boolean, subPoint = false) => `w-full text-left py-2 text-sm transition-colors disabled:opacity-50 ${subPoint ? 'pl-7 pr-3' : 'px-3'} ${selected
  ? 'bg-blue-50 font-medium text-blue-700 dark:bg-blue-900/50 dark:text-blue-200'
  : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'}`;

/** Shared choices only: the owner decides when selection is accepted and the popup closes. */
export function OutlinePointOptions({ groups, outlinePointId, subPointId, onSelect, disabled = false, allowClear = true }: OutlinePointOptionsProps) {
  const { t } = useTranslation();
  return <>
    {allowClear && <button type="button" onClick={() => onSelect(null, null)} disabled={disabled} className={optionClass(!outlinePointId)}>
      {t('editThought.noSermonPoint')}
    </button>}
    {Object.entries(groups).map(([section, points]) => points?.length ? <div key={section}>
      <div className="bg-gray-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:bg-gray-900/50 dark:text-gray-400">
        {t(`outline.${section === 'main' ? 'mainPoints' : section}`)}
      </div>
      {points.map(point => <div key={point.id}>
        <button type="button" disabled={disabled} onClick={() => onSelect(point.id, null)} className={optionClass(outlinePointId === point.id && !subPointId)}>
          {point.text}
        </button>
        {sortSubPointsByPosition(point.subPoints).map(subPoint => <button type="button" key={subPoint.id} disabled={disabled}
          onClick={() => onSelect(point.id, subPoint.id)} className={optionClass(outlinePointId === point.id && subPointId === subPoint.id, true)}>
          <span className="inline-flex items-center gap-1.5"><span className="h-1 w-1 shrink-0 rounded-full bg-gray-400 dark:bg-gray-500" />{subPoint.text}</span>
        </button>)}
      </div>)}
    </div> : null)}
  </>;
}
