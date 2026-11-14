import { adminDb } from '@/config/firebaseAdminConfig';

import { clone } from './storage';

type Raw = Record<string, unknown>;
type Filter = { kind: 'field'; field: string; operator: string; value: unknown } | { kind: 'or'; filters: Filter[] };
const matches = (data: Raw, filter: Filter): boolean => filter.kind === 'or'
  ? filter.filters.some(part => matches(data, part))
  : filter.operator === 'array-contains' ? Array.isArray(data[filter.field]) && (data[filter.field] as unknown[]).includes(filter.value)
    : data[filter.field] === filter.value;

/** Same serialized transaction/query model as __tests__/data-engine/server.test.ts. */
export function installWorldFirestore(now: () => number) {
  const documents = new Map<string, Raw>();
  let tail: Promise<unknown> = Promise.resolve();
  let activity = 0, pending = 0;
  const snapshot = (path: string) => ({ readTime: { toMillis: now }, exists: documents.has(path), data: () => clone(documents.get(path)), id: path.split('/').at(-1)! });
  function queryFor(collection: string) {
    let maximum = Infinity, cursor = '';
    const filters: Filter[] = [];
    const query = {
      doc: (id: string) => ref(`${collection}/${id}`),
      where: (field: string | Filter, operator: string, value: unknown) => { filters.push(typeof field === 'string' ? { kind: 'field', field, operator, value } : field); return query; },
      orderBy: () => query,
      limit: (value: number) => { maximum = value; return query; },
      startAfter: (value: string) => { cursor = value; return query; },
      get: async () => ({ readTime: { toMillis: now }, docs: [...documents].filter(([key, data]) => key.startsWith(collection + '/') && !key.slice(collection.length + 1).includes('/') && key.slice(collection.length + 1) > cursor && filters.every(filter => matches(data, filter)))
        .sort(([a], [b]) => a.localeCompare(b)).slice(0, maximum).map(([path]) => snapshot(path)) }),
    };
    return query;
  }
  function ref(path: string): { path: string; get(): Promise<ReturnType<typeof snapshot>>; collection(name: string): ReturnType<typeof queryFor> } {
    return { path, get: async () => snapshot(path), collection: name => queryFor(path + '/' + name) };
  }
  (adminDb.collection as jest.Mock).mockImplementation(queryFor);
  (adminDb.runTransaction as jest.Mock).mockImplementation((callback: (tx: unknown) => Promise<unknown>) => {
    pending++;
    const run = tail.then(async () => {
      activity++;
      const writes = new Map<string, Raw>();
      const result = await callback({
        get: async (reference: { path?: string; get(): Promise<unknown> }) => {
          if (writes.size) throw new Error('Firestore requires all reads before writes');
          return reference.path ? snapshot(reference.path) : reference.get();
        },
        set: (reference: { path: string }, value: Raw, options?: { merge?: boolean }) => {
          const merged = options?.merge ? { ...(writes.get(reference.path) ?? documents.get(reference.path)) } : {};
          for (const [field, incoming] of Object.entries(value)) {
            merged[field] = incoming && typeof incoming === 'object' && '__testIncrement' in incoming
              ? Number(merged[field] ?? 0) + Number(incoming.__testIncrement) : clone(incoming);
          }
          writes.set(reference.path, merged);
        },
      });
      for (const [key, value] of writes) documents.set(key, value);
      return result;
    }).finally(() => { pending--; });
    tail = run.catch(() => undefined);
    return run;
  });
  return { documents, get activity() { return activity; }, get pending() { return pending; } };
}
