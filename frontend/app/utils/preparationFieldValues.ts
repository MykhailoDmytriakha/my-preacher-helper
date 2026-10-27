import type { Json } from '@/data-engine/types';

/** Raw field views and explicit-save normalization; no storage or delivery ownership. */
export interface PreparationValue<T> {
  read(value: Json | undefined): T;
  save(value: T): Json;
  describe(value: T): string;
  valid?(value: T): boolean;
}

export type PreparationPlanItem = { id: string; title: string };
export const trimmedPreparationText: PreparationValue<string> = {
  read: value => typeof value === 'string' ? value : '', save: value => value.trim(), describe: value => value,
};
export const preparationWords: PreparationValue<string> = {
  read: value => typeof value === 'string' ? value : Array.isArray(value) ? value.join(', ') : '',
  save: value => value.split(',').map(word => word.trim()).filter(Boolean), describe: value => value,
};
export const preparationPlan: PreparationValue<PreparationPlanItem[]> = {
  read: value => Array.isArray(value) ? value as PreparationPlanItem[] : [],
  save: value => value.map(item => ({ id: item.id, title: item.title.trim() })) as Json,
  describe: value => value.map((item, index) => `${index + 1}. ${item.title}`).join('\n'),
  valid: value => value.every(item => item.title.trim().length > 0),
};
