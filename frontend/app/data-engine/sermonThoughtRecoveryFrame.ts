import { readField, writeField } from './fieldValues';

import type { DocumentData } from './types';

const fields = ['thoughts', 'structure', 'thoughtsBySection'] as const;

export const sermonThoughtFrame = (value: DocumentData) => fields.map(field => readField(value, [field]));

export const copySermonThoughtFrame = (value: DocumentData, source: DocumentData) => fields.reduce(
  (result, field) => writeField(result, [field], readField(source, [field])), value);
