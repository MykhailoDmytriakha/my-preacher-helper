import type { Firestore } from 'firebase-admin/firestore';

type Data = Record<string, any>;
export function legacyRepositoryFixture(database: Firestore) {
  const records = new Map<string, Data>();
  let autoId = 0, attempts = 0;
  let transition: (() => void) | undefined;
  let failCommit = false;
  const clone = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value));
  const ref = (path: string): any => ({ path, id: path.split('/')[1], get: async () => snap(ref(path)) });
  const snap = (reference: any) => {
    const captured = clone(records.get(reference.path));
    return { ref: reference, id: reference.id, exists: captured !== undefined, data: () => clone(captured) };
  };
  const query = (collection: string, filters: Array<[string, string, unknown]> = [], limit = 1000): any => ({
    collection, filters, maximum: limit,
    where: (field: string, op: string, value: unknown) => query(collection, [...filters, [field, op, value]], limit),
    limit: (next: number) => query(collection, filters, next),
    doc: (id?: string) => ref(`${collection}/${id ?? `auto-${++autoId}`}`),
    get: async () => select(collection, filters, limit),
  });
  const select = (collection: string, filters: Array<[string, string, unknown]>, limit: number) => {
    const docs = [...records].filter(([path, data]) => path.startsWith(`${collection}/`) && filters.every(([field, op, value]) =>
      op === 'array-contains' ? Array.isArray(data[field]) && data[field].includes(value) : data[field] === value))
      .slice(0, limit).map(([path]) => snap(ref(path)));
    return { docs, empty: !docs.length, forEach: (callback: (value: unknown) => void) => docs.forEach(callback) };
  };
  const merge = (before: Data, patch: Data) => {
    const result = clone(before);
    for (const [field, value] of Object.entries(patch)) {
      if (value?._op === 'union') result[field] = [...new Set([...(result[field] ?? []), ...value.values])];
      else if (value?._op === 'remove') result[field] = (result[field] ?? []).filter((item: unknown) => !value.values.includes(item));
      else if (field.includes('.')) { const [parent, child] = field.split('.'); result[parent] = { ...result[parent], [child]: value?._op === 'increment' ? (result[parent]?.[child] ?? 0) + value.values[0] : value }; }
      else result[field] = value;
    }
    return result;
  };
  jest.mocked(database.collection).mockImplementation(name => query(name));
  jest.mocked(database.runTransaction).mockImplementation(async callback => {
    for (;;) {
      attempts++;
      const before = JSON.stringify([...records]);
      const writes: Array<() => void> = [];
      const result = await callback({
        get: async (target: any) => {
          if (writes.length) throw new Error('Reads after writes');
          return target.collection ? select(target.collection, target.filters, target.maximum) : snap(target);
        },
        create: (target: any, value: Data) => writes.push(() => { if (records.has(target.path)) throw new Error('Already exists'); records.set(target.path, clone(value)); }),
        set: (target: any, value: Data, options?: { merge: boolean }) => writes.push(() => records.set(target.path, options?.merge ? merge(records.get(target.path) ?? {}, value) : clone(value))),
        update: (target: any, value: Data) => writes.push(() => { if (!records.has(target.path)) throw new Error('Missing'); records.set(target.path, merge(records.get(target.path)!, value)); }),
        delete: (target: any) => writes.push(() => records.delete(target.path)),
      } as never);
      const race = transition; transition = undefined; race?.();
      if (before !== JSON.stringify([...records])) continue;
      if (failCommit) throw new Error('Commit failed');
      writes.forEach(write => write());
      return result;
    }
  });
  return { records, race: (callback: () => void) => { transition = callback; }, fail: () => { failCommit = true; }, attempts: () => attempts };
}
