import type { DocumentData, FieldValue, Json } from './types';

export const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
export const object = (value: unknown): value is DocumentData => value !== null
  && typeof value === 'object' && !Array.isArray(value);

export function commandFingerprint(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(commandFingerprint).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${commandFingerprint(value[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}

export function equalValues(a: unknown, b: unknown): boolean {
  return commandFingerprint(a) === commandFingerprint(b);
}

export function readField(data: DocumentData, path: readonly string[]): FieldValue {
  let current: Json = data;
  for (const key of path) {
    if (!object(current) || !own(current, key)) return { exists: false };
    current = current[key];
  }
  return { exists: true, value: current };
}

/** Set only the selected leaf. Clearing an absent value never creates a parent object. */
export function writeField(data: DocumentData, [key, ...path]: readonly string[], field: FieldValue): DocumentData {
  if (!path.length) {
    const next = { ...data };
    if (field.exists) next[key] = field.value!;
    else delete next[key];
    return next;
  }
  const child = data[key];
  if (!field.exists && !object(child)) return data;
  return { ...data, [key]: writeField(object(child) ? child : {}, path, field) };
}
