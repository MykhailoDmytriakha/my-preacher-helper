/** @jest-environment node */
import { randomUUID } from 'node:crypto';
import { adminDb } from '@/config/firebaseAdminConfig';
import { assertLegacyWritable, runLegacyTransaction } from '@/data-engine/legacyBoundary.server';
import { processCommand, readDocument } from '@/data-engine/server';

jest.mock('@/config/firebaseAdminConfig', () => {
  if (process.env.DATA_ENGINE_EMULATOR_TEST !== 'true') return { adminDb: {} };
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8188') throw new Error('Use localhost emulator on port 8188');
  process.env.METADATA_SERVER_DETECTION = 'none';
  const { initializeApp } = jest.requireActual('firebase-admin/app');
  const { getFirestore } = jest.requireActual('firebase-admin/firestore');
  return { adminDb: getFirestore(initializeApp({ projectId: 'demo-data-engine-legacy' }, 'legacy-guard-integration')) };
});
const run = process.env.DATA_ENGINE_EMULATOR_TEST === 'true' ? describe : describe.skip;
run('legacy cutover against real Firestore transactions', () => {
  jest.setTimeout(30_000);
  const environment = { ...process.env };
  beforeEach(() => { process.env.DATA_ENGINE_ENABLED = 'true'; });
  afterAll(async () => { process.env = environment; await adminDb.terminate(); });
  it('refuses an in-flight legacy save whose successful preflight predates the engine transition', async () => {
    const owner = `legacy-overlap-${randomUUID()}`;
    const resource = { collection: 'sermons', id: owner };
    const reference = adminDb.collection(resource.collection).doc(resource.id);
    await reference.set({ userId: owner, title: 'Before', verse: 'John 1:1', date: '2026-09-12', thoughts: [] });
    assertLegacyWritable((await reference.get()).data());
    let release!: () => void, entered!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    // The request passed its early owner/marker check, but its transaction has not
    // read the target yet. This deterministically reproduces the outside-check race.
    const pending = runLegacyTransaction(async transaction => {
      entered(); await barrier;
      await transaction.get(reference);
      transaction.update(reference, { title: 'Stale legacy write' });
    });
    const refusal = expect(pending).rejects.toMatchObject({ code: 'data-engine-required' });
    await started;
    try {
      const result = await processCommand(owner, { protocol: 1, owner, operationId: `${owner}-transition`, resource, generation: null, dependsOn: [], kind: 'update',
        changes: [{ path: ['title'], before: { exists: true, value: 'Before' }, after: { exists: true, value: 'Engine commit' } }] });
      expect(result.kind).toBe('acknowledged');
    } finally { release(); await refusal; }
    expect((await readDocument(owner, resource)).value?.title).toBe('Engine commit');
  });
});
