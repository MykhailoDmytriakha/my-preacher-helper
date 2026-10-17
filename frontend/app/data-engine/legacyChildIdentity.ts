import { serializeContent } from '@/utils/contentFingerprint';

import type { IssueData, ZodIssue, ZodTypeAny } from 'zod';

type Scope = 'siblings' | 'outline';
const marker = 'resource-child-identity';

/** Machine-readable identity defects; other schema failures never inherit an allowance. */
export function childIdentityIssue(scope: Scope, identity: string, occurrence: number, path: (string | number)[]): IssueData {
  return { code: 'custom', path,
    message: scope === 'siblings' ? 'Child identity must be unique' : 'Outline identity must be globally unique',
    params: { constraint: marker, scope, identity, occurrence } };
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** One uniqueness rule for schema admission and relation inputs that require an addressable row. */
export function childIdentityIssues(values: readonly unknown[]): IssueData[] {
  const seen = new Map<string, number>();
  const issues: IssueData[] = [];
  values.forEach((value, index) => {
    if (!object(value) || typeof value.id !== 'string') {
      issues.push({ code: 'custom', path: [index, 'id'], message: 'Child identity must be unique' });
      return;
    }
    const count = (seen.get(value.id) ?? 0) + 1;
    if (count > 1) issues.push(childIdentityIssue('siblings', value.id, count, [index, 'id']));
    seen.set(value.id, count);
  });
  return issues;
}

/** Array positions are not parent identity: a reordered unique parent keeps its own list. */
function listScope(value: unknown, path: (string | number)[]): unknown[] | null {
  const scope: unknown[] = [];
  for (const part of path) {
    if (typeof part === 'string') {
      if (!object(value)) return null;
      scope.push(part);
      value = value[part];
    } else {
      if (!Array.isArray(value)) return null;
      const parent = value[part];
      if (!object(parent) || typeof parent.id !== 'string') return null;
      const peers = value.filter(entry => object(entry) && entry.id === parent.id);
      const unique = peers.length === 1;
      // Two parents with one ID have no distinguishable address. Only the unchanged
      // peer group can witness which legacy defect they held; never guess by position.
      scope.push(unique ? { parent: parent.id } : { parent: parent.id, position: peers.indexOf(parent), witness: serializeContent(peers) });
      value = parent;
    }
  }
  return Array.isArray(value) ? scope : null;
}

function defectKey(issue: ZodIssue, value: unknown): string | null {
  if (issue.code !== 'custom' || issue.params?.constraint !== marker) return null;
  const { scope, identity, occurrence } = issue.params;
  if ((scope !== 'siblings' && scope !== 'outline') || typeof identity !== 'string'
    || !Number.isInteger(occurrence) || occurrence < 2) return null;
  const location = scope === 'outline' ? [] : listScope(value, issue.path.slice(0, -2));
  return location ? JSON.stringify([scope, location, identity, occurrence]) : null;
}

/** Return the rows governed by this issue, including outline-wide identities. */
function duplicateRows(issue: ZodIssue, value: unknown): Record<string, unknown>[] {
  if (issue.code !== 'custom') return [];
  const identity = issue.params?.identity;
  if (issue.params?.scope === 'outline') {
    if (!object(value)) return [];
    return ['introduction', 'main', 'conclusion'].flatMap(name => {
      const points = value[name];
      return Array.isArray(points) ? points.filter(object).flatMap(point => [point, ...(Array.isArray(point.subPoints) ? point.subPoints.filter(object) : [])]) : [];
    }).filter(row => row.id === identity);
  }
  let list = value;
  for (const part of issue.path.slice(0, -2)) {
    if (typeof part === 'number' && Array.isArray(list)) list = list[part];
    else if (typeof part === 'string' && object(list)) list = list[part];
    else return [];
  }
  return Array.isArray(list) ? list.filter(object).filter(row => row.id === identity) : [];
}

/** No ambiguous row is rewritten or copied; removing held copies remains a repair. */
function retainsRows(after: Record<string, unknown>[], before: Record<string, unknown>[], ignoredFields: readonly string[]): boolean {
  const fingerprint = (row: Record<string, unknown>) => serializeContent(Object.fromEntries(Object.entries(row).filter(([key]) => !ignoredFields.includes(key))));
  const held = new Map<string, number>();
  for (const row of before) {
    const key = fingerprint(row);
    held.set(key, (held.get(key) ?? 0) + 1);
  }
  return after.every(row => {
    const key = fingerprint(row), count = held.get(key) ?? 0;
    if (!count) return false;
    held.set(key, count - 1);
    return true;
  });
}

/** Retain unchanged legacy rows in their own list, never grant an ambiguous edit. */
export function keepsExistingChildIdentities(schema: ZodTypeAny, value: unknown, previous: unknown, issues: ZodIssue[], ignoredFields: readonly string[] = []): boolean {
  if (previous === undefined || !issues.length) return false;
  const keys = issues.map(issue => defectKey(issue, value));
  if (keys.some(key => key === null)) return false;
  const before = schema.safeParse(previous);
  if (before.success) return false;
  const held = new Map(before.error.issues.flatMap(issue => {
    const key = defectKey(issue, previous);
    return key === null ? [] : [[key, issue] as const];
  }));
  const checked = new Set<string>();
  return issues.every((issue, index) => {
    const key = keys[index], prior = key === null ? undefined : held.get(key);
    if (!prior || key === null) return false;
    const group = JSON.stringify(JSON.parse(key).slice(0, -1));
    if (checked.has(group)) return true;
    checked.add(group);
    return retainsRows(duplicateRows(issue, value), duplicateRows(prior, previous), ignoredFields);
  });
}
