/** @jest-environment node */
jest.mock('server-only', () => ({}), { virtual: true });
import { audioExportFirestore } from '../../../../../../test-utils/audioExportFirestore';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { adminDb } from '@/config/firebaseAdminConfig';
import { beginAudioExportBatch } from '@/data-engine/serverOperations.server';

jest.mock('next/server', () => ({ NextResponse: { json: (value: unknown, options?: { status?: number }) => ({ status: options?.status ?? 200, json: async () => value }) } }));
jest.mock('@/api/auth/requireAuthenticatedUid.server', () => ({ getRequiredAuthenticatedUid: jest.fn() }));
jest.mock('@/config/firebaseAdminConfig', () => ({ adminDb: { collection: jest.fn(), getAll: jest.fn(), runTransaction: jest.fn() } }));
jest.mock('@/utils/server/audioDurationMetering.server', () => ({ getMeteredAudioDurationSeconds: jest.fn(async () => 2) }));

const { POST } = require('@/api/sermons/[id]/audio/generate/ack/route') as typeof import('@/api/sermons/[id]/audio/generate/ack/route');
const invoke = (exportId: unknown) => POST({ json: async () => ({ exportId }) } as never, { params: Promise.resolve({ id: 'sermon' }) });
let io: ReturnType<typeof audioExportFirestore>;
const start = (exportId = 'qa-export') => beginAudioExportBatch({ userId: 'owner', sermonId: 'sermon', exportId,
  fingerprint: 'saved-plan', total: 1, offset: 0, limit: 1, entitlement: { paidTier: 'free' } });
const complete = async (exportId = 'qa-export') => {
  const batch = await start(exportId);
  await batch.chunk(0, 'Saved speech', async () => ({ audioBlob: new Blob(['audio'], { type: 'audio/mpeg' }), index: 0, durationSeconds: 99 }));
  await batch.complete();
};
const cacheCount = () => [...io.documents.keys()].filter(key => key.includes('_audioExportCache')).length;

describe('audio delivery acknowledgement route', () => {
  beforeEach(() => {
    io = audioExportFirestore();
    (adminDb.collection as jest.Mock).mockImplementation(name => io.db.collection(name));
    (adminDb.getAll as jest.Mock).mockImplementation((...references) => io.db.getAll(...references));
    (adminDb.runTransaction as jest.Mock).mockImplementation(callback => io.db.runTransaction(callback));
    (getRequiredAuthenticatedUid as jest.Mock).mockResolvedValue('owner');
  });

  it('rejects signed-out callers before reading their body', async () => {
    (getRequiredAuthenticatedUid as jest.Mock).mockResolvedValue(null);
    const json = jest.fn();
    expect((await POST({ json } as never, { params: Promise.resolve({ id: 'sermon' }) })).status).toBe(401);
    expect(json).not.toHaveBeenCalled();
  });

  it('refuses malformed acknowledgement identities', async () => {
    expect((await invoke(undefined)).status).toBe(400);
    expect((await invoke('../foreign')).status).toBe(400);
    expect(io.documents.size).toBe(0);
  });

  it('cleans delivered audio and safely repeats even when the sermon has already been deleted', async () => {
    await complete(); expect(cacheCount()).toBe(2);
    expect(io.documents.has('sermons/sermon')).toBe(false);
    expect((await invoke('qa-export')).status).toBe(200);
    expect(cacheCount()).toBe(0);
    expect((await invoke('qa-export')).status).toBe(200);
  });

  it('does not clear another owner or a newer export', async () => {
    await complete();
    (getRequiredAuthenticatedUid as jest.Mock).mockResolvedValue('other');
    expect((await invoke('qa-export')).status).toBe(200); expect(cacheCount()).toBe(2);
    (getRequiredAuthenticatedUid as jest.Mock).mockResolvedValue('owner');
    await complete('qa-newer');
    expect((await invoke('qa-export')).status).toBe(200); expect(cacheCount()).toBe(2);
  });

  it('refuses acknowledgement before the planned final batch completes', async () => {
    await start();
    expect((await invoke('qa-export')).status).toBe(409);
  });

  it('permits an exact cleanup retry after the first deletion transaction fails', async () => {
    await complete(); let once = true;
    io.fault(paths => { if (once && paths.some(path => path.includes('_audioExportCache'))) { once = false; return 'before'; } });
    expect((await invoke('qa-export')).status).toBe(500); expect(cacheCount()).toBe(2);
    expect((await invoke('qa-export')).status).toBe(200); expect(cacheCount()).toBe(0);
  });
});
