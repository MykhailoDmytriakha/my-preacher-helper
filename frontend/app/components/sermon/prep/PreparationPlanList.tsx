import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';

import { usePreparationFieldOpening } from '@/hooks/usePreparationFieldOpening';
import { UI_COLORS } from '@/utils/themeColors';
import { useTranslation } from '@locales/useTranslation';

import { PreparationFieldActions, PreparationFieldStatus } from './PreparationTextarea';

import type { PreparationFieldBinding } from '@/components/common/manualTextBinding';
import type { PreparationPlanItem } from '@/utils/preparationFieldValues';

export type PreparationPlanBinding = PreparationFieldBinding<PreparationPlanItem[]> & {
  edit(updater: (current: PreparationPlanItem[]) => PreparationPlanItem[]): Promise<void>;
};
const genId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function PreparationPlanList({ binding, kind }: { binding?: PreparationPlanBinding; kind: 'updatedPlan' | 'sermonPlan' }) {
  usePreparationFieldOpening(binding);
  const { t } = useTranslation();
  const prefix = `wizard.steps.homileticPlan.fields.${kind}`;
  const edit = (updater: (current: PreparationPlanItem[]) => PreparationPlanItem[]) => {
    if (binding) void binding.edit(updater).catch(() => undefined);
  };
  const move = (id: string, direction: number) => edit(current => {
    const index = current.findIndex(item => item.id === id), target = index + direction;
    if (index < 0 || target < 0 || target >= current.length) return current;
    const next = [...current]; [next[index], next[target]] = [next[target], next[index]]; return next;
  });
  return <fieldset className={`min-w-0 p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`} disabled={!binding?.ready}>
    <div className="flex items-center justify-between mb-2">
      <label className="text-xs font-medium">{t(`${prefix}.label`)}</label>
      <button type="button" onClick={() => { const id = genId(); edit(current => [...current, { id, title: '' }]); }}
        className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`} title={t(`${prefix}.addItem`)}>
        <Plus className="w-4 h-4" /> {t(`${prefix}.addItem`)}
      </button>
    </div>
    <ul className="space-y-2">
      {(binding?.value ?? []).map(item => <li key={item.id} className="flex items-center gap-2">
        <input type="text" value={item.title} onChange={event => { const title = event.target.value; edit(current => current.map(point => point.id === item.id ? { ...point, title } : point)); }}
          placeholder={t(`${prefix}.itemPlaceholder`)} aria-label={t(`${prefix}.itemLabel`)}
          className={`flex-1 rounded-md border px-3 py-2 bg-white dark:bg-gray-800 ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} focus:outline-none focus:ring-2 focus:ring-offset-0`} />
        {([['moveUp', ArrowUp, () => move(item.id, -1)], ['moveDown', ArrowDown, () => move(item.id, 1)],
          ['remove', Trash2, () => edit(current => current.filter(point => point.id !== item.id))]] as const).map(([name, Icon, action]) =>
          <button key={name} type="button" onClick={action} title={t(`${prefix}.${name}`)} aria-label={t(`${prefix}.${name}`)}
            className={`inline-flex items-center justify-center px-2 py-1 rounded-md text-xs border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}><Icon className="w-4 h-4" /></button>)}
      </li>)}
    </ul>
    {binding && <><PreparationFieldActions binding={binding} value={binding.value} /><PreparationFieldStatus binding={binding} /></>}
  </fieldset>;
}
