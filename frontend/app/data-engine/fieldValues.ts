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

export function readField(data: DocumentData, path: string[]): FieldValue {
  let current: Json = data;
  for (const key of path) {
    if (!object(current) || !own(current, key)) return { exists: false };
    current = current[key];
  }
  return { exists: true, value: current };
}
