import type { Firestore } from 'firebase-admin/firestore';

type Data = Record<string, any>;
type Ref = { path: string; id: string; get: () => Promise<any>; collection: (name: string) => any };
/** Controlled IO, not a Firestore emulator. Queued transactions publish writes atomically. */
export function audioExportFirestore() {
  const documents = new Map<string, Data>();
  let tail: Promise<unknown> = Promise.resolve();
  let insideTransaction = false;
  let failCommit: ((paths: string[]) => 'before' | 'after' | undefined) | undefined;
  const copy = <T,>(value: T): T => structuredClone(value);
  const snapshot = (path: string) => ({ ref: ref(path), id: path.split('/').at(-1)!, exists: documents.has(path), data: () => documents.has(path) ? copy(documents.get(path)) : undefined });
  const ref = (path: string): Ref => ({ path, id: path.split('/').at(-1)!, get: async () => snapshot(path), collection: name => collection(`${path}/${name}`) });
  const collection = (path: string) => ({
    doc: (id: string) => ref(`${path}/${id}`),
    select: (...fields: string[]) => ({ get: async () => ({ docs: [...documents.keys()].filter(key => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/')).map(key => ({ ...snapshot(key), data: () => Object.fromEntries(fields.map(field => [field, documents.get(key)?.[field]])) })) }) }),
  });
  const api = {
    collection,
    getAll: async (...references: Ref[]) => references.map(reference => snapshot(reference.path)),
    runTransaction: <T,>(callback: (transaction: any) => Promise<T>): Promise<T> => {
      const result = tail.then(async () => {
        const writes: Array<{ path: string; data?: Data; merge?: boolean }> = [];
        let writing = false;
        const read = (reference: Ref) => { if (writing) throw new Error('Transaction read after write'); return snapshot(reference.path); };
        insideTransaction = true;
        try {
          const value = await callback({
            get: async (reference: Ref) => read(reference),
            getAll: async (...references: Ref[]) => references.map(read),
            set: (reference: Ref, data: Data, options?: { merge?: boolean }) => { writing = true; writes.push({ path: reference.path, data: copy(data), merge: options?.merge }); },
            delete: (reference: Ref) => { writing = true; writes.push({ path: reference.path }); },
          });
          const fault = failCommit?.(writes.map(write => write.path));
          if (fault === 'before') throw new Error('Controlled commit failure before publication');
          for (const write of writes) {
            if (write.data === undefined) documents.delete(write.path);
            else documents.set(write.path, write.merge ? { ...documents.get(write.path), ...write.data } : write.data);
          }
          if (fault === 'after') throw new Error('Controlled lost commit acknowledgement');
          return value;
        } finally { insideTransaction = false; }
      });
      tail = result.catch(() => undefined);
      return result;
    },
  };
  return { db: api as unknown as Firestore, documents, ref,
    insideTransaction: () => insideTransaction,
    fault: (callback: typeof failCommit) => { failCommit = callback; } };
}
