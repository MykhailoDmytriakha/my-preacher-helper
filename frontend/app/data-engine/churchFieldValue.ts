import { object, own } from './fieldValues';

import type { DocumentData, FieldValue } from './types';

export type ChurchValue = DocumentData & { id: string; name: string; city?: string };
const short = (value: unknown): value is string => typeof value === 'string' && value.length <= 1024;

export const isChurchValue = (value: unknown): value is ChurchValue => object(value) && short(value.id) && short(value.name)
  && (!own(value, 'city') || short(value.city)) && Object.keys(value).every(key => ['id', 'name', 'city'].includes(key));

export const isSermonChurch = (field: FieldValue): boolean => !field.exists || isChurchValue(field.value);
