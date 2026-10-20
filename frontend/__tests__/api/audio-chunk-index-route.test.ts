import { adminDb } from '@/config/firebaseAdminConfig';
import { __resetStoreAvailabilityForTests } from '@/services/storeAvailability.server';
import { PUT } from '@/api/sermons/[id]/audio/chunks/[index]/route';
import { writeOwnedDocument } from '@/data-engine/serverEdit.server';
import { mutateLegacyResource } from '@/data-engine/legacyBoundary.server';

import type { NextRequest } from 'next/server';

/**
 * A CORRECTION NAMES A POSITION, NOT A CHUNK (BUG-20260810-audio-chunks-whole-array).
 *
 * After a source switch that did not land, the chunk at index 0 belongs to the other source. The
 * set the editor opened on travels along; the correction lands only while that set is stored.
 */
let stored: Record<string, unknown> = {};
let engineCurrent: Record<string, unknown> = {};
let written: Record<string, unknown> | null = null;

jest.mock('next/server', () => ({
  NextResponse: { json: jest.fn((data: unknown, init: { status?: number } = {}) => ({ status: init.status ?? 200, json: async () => data })) },
}));
jest.mock('@/api/auth/requireAuthenticatedUid.server', () => ({ getRequiredAuthenticatedUid: jest.fn().mockResolvedValue('owner-1') }));
jest.mock('@/config/firebaseAdminConfig', () => ({
  adminDb: { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, id: 's1', data: () => stored }) }) }) },
}));
jest.mock('@/data-engine/legacyBoundary.server', () => ({
  ...jest.requireActual('@/data-engine/legacyBoundary.server'),
  updateLegacyDocument: jest.fn(),
  mutateLegacyResource: jest.fn(async (_resource: unknown, mutate: (current: Record<string, unknown>) => Record<string, unknown> | null) => {
    const patch = mutate(stored);
    if (patch) stored = { ...stored, ...patch };
  }),
}));
jest.mock('@/data-engine/serverEdit.server', () => ({
  ...jest.requireActual('@/data-engine/serverEdit.server'),
  assertServerWritable: jest.fn(),
  writeOwnedDocument: jest.fn(async ({ engine }: { engine: (current: Record<string, unknown>) => Record<string, unknown> }) => {
    written = engine(JSON.parse(JSON.stringify(engineCurrent)));
    return written;
  }),
}));

const chunk = (text: string) => ({ sectionId: 'introduction', index: 0, text, createdAt: '2026-09-01T00:00:00.000Z' });
const put = (body: unknown) => PUT(
  { json: async () => body } as unknown as NextRequest,
  { params: Promise.resolve({ id: 's1', index: '0' }) },
);

beforeEach(() => {
  written = null;
  stored = { userId: 'owner-1', audioChunks: [chunk('Polished opening')], audioMetadata: { mode: 'ai' } };
  engineCurrent = stored;
  jest.mocked(writeOwnedDocument).mockClear();
  jest.mocked(mutateLegacyResource).mockClear();
});

it('corrects the chunk the editor opened with', async () => {
  const response = await put({ text: 'Polished, corrected', expected: [chunk('Polished opening')] });
  expect(response.status).toBe(200);
  expect((written?.audioChunks as Array<{ text: string }>)[0].text).toBe('Polished, corrected');
});

it('refuses a correction whose chunk is no longer at that position', async () => {
  stored = { userId: 'owner-1', audioChunks: [chunk('Raw opening')], audioMetadata: { mode: 'raw' } };
  engineCurrent = stored;
  const response = await put({ text: 'Polished, corrected', expected: [chunk('Polished opening')] });
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: 'chunks-changed', mode: 'raw' });
  expect(writeOwnedDocument).not.toHaveBeenCalled();
});

it('refuses when the chunk changes between the check and the write', async () => {
  engineCurrent = { ...stored, audioChunks: [chunk('Changed a moment later')] };
  const response = await put({ text: 'Polished, corrected', expected: [chunk('Polished opening')] });
  expect(response.status).toBe(409);
  expect((await response.json()).chunks[0].text).toBe('Changed a moment later');
  expect(written).toBeNull();
});

it('refuses when the same words sit at that position in another source\'s set', async () => {
  // "Amen" opened in the AI set; the original set stored meanwhile also starts with "Amen".
  stored = { userId: 'owner-1', audioChunks: [chunk('Amen'), chunk('Raw second part')], audioMetadata: { mode: 'raw' } };
  engineCurrent = stored;
  const response = await put({ text: 'Amen, corrected', expected: [chunk('Amen'), chunk('Polished second part')] });
  expect(response.status).toBe(409);
  expect(writeOwnedDocument).not.toHaveBeenCalled();
});

it('refuses when the very same words are stored as the other source', async () => {
  stored = { userId: 'owner-1', audioChunks: [chunk('Amen')], audioMetadata: { mode: 'raw' } };
  engineCurrent = stored;
  const response = await put({ text: 'Amen, corrected', expected: [chunk('Amen')], mode: 'ai' });
  expect(response.status).toBe(409);
  expect(writeOwnedDocument).not.toHaveBeenCalled();
});

it('answers a set that shrank since the editor opened with what is stored, not a bare out-of-range', async () => {
  stored = { userId: 'owner-1', audioChunks: [], audioMetadata: { mode: 'ai' } };
  engineCurrent = stored;
  const response = await put({ text: 'Polished, corrected', expected: [chunk('Polished opening')], mode: 'ai' });
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: 'chunks-changed', chunks: [] });
});

const prepared = (text: string, id: string, revision: number) => ({
  id, revision, sections: ['introduction'], chunks: [chunk(text)],
});

it('edits the captured source while another source is active and increments only its revision', async () => {
  const ai = prepared('AI opening', 'ai-source', 4);
  const raw = prepared('Raw opening', 'raw-source', 8);
  stored = { userId: 'owner-1', audioChunks: ai.chunks, audioMetadata: { mode: 'ai', chunksCount: 1, voice: 'kept' }, audioSources: { ai, raw } };
  engineCurrent = JSON.parse(JSON.stringify(stored));
  const response = await put({ text: 'Raw corrected', mode: 'raw', source: { id: raw.id, revision: raw.revision }, expected: raw.chunks });
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.source).toEqual({ id: 'raw-source', revision: 9 });
  expect(body.sources.raw.chunks[0].text).toBe('Raw corrected');
  expect(written?.audioSources).toMatchObject({
    ai: { id: 'ai-source', revision: 4, chunks: [{ text: 'AI opening' }] },
    raw: { id: 'raw-source', revision: 9, chunks: [{ text: 'Raw corrected' }] },
  });
  expect(written?.audioMetadata).toMatchObject({ mode: 'raw', voice: 'kept' });
});

it('refuses a stale source id even when the selected source has the same words', async () => {
  const current = prepared('Same opening', 'current-source', 5);
  stored = { userId: 'owner-1', audioChunks: current.chunks, audioMetadata: { mode: 'ai' }, audioSources: { ai: current } };
  engineCurrent = JSON.parse(JSON.stringify(stored));
  const response = await put({ text: 'Correction', mode: 'ai', source: { id: 'old-source', revision: 5 }, expected: current.chunks });
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: 'chunks-changed', chunks: current.chunks, source: { id: 'current-source', revision: 5 } });
  expect(written).toBeNull();
});

it('refuses a stale source revision even when the selected source has the same words', async () => {
  const current = prepared('Same opening', 'same-source', 6);
  stored = { userId: 'owner-1', audioChunks: current.chunks, audioMetadata: { mode: 'ai' }, audioSources: { ai: current } };
  engineCurrent = JSON.parse(JSON.stringify(stored));
  const response = await put({ text: 'Correction', mode: 'ai', source: { id: 'same-source', revision: 5 }, expected: current.chunks });
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: 'chunks-changed', chunks: current.chunks, source: { id: 'same-source', revision: 6 } });
  expect(written).toBeNull();
});

it('uses the same guarded source edit on the legacy transaction road', async () => {
  const current = prepared('Raw opening', 'raw-source', 2);
  stored = { userId: 'owner-1', audioChunks: current.chunks, audioMetadata: { mode: 'raw' }, audioSources: { raw: current } };
  engineCurrent = JSON.parse(JSON.stringify(stored));
  jest.mocked(writeOwnedDocument).mockImplementationOnce(async ({ legacy }: { legacy: () => Promise<void> }) => {
    await legacy();
    return null;
  });
  const response = await put({ text: 'Legacy correction', mode: 'raw', source: { id: 'raw-source', revision: 2 }, expected: current.chunks });
  expect(response.status).toBe(200);
  expect(mutateLegacyResource).toHaveBeenCalledTimes(1);
  expect((stored.audioSources as { raw: { revision: number; chunks: Array<{ text: string }> } }).raw)
    .toMatchObject({ revision: 3, chunks: [{ text: 'Legacy correction' }] });
});

it('keeps a tokenless old-client edit synchronized with the active prepared source', async () => {
  const ai = prepared('AI opening', 'ai-source', 7);
  const raw = prepared('Raw opening', 'raw-source', 3);
  stored = { userId: 'owner-1', audioChunks: ai.chunks, audioMetadata: { mode: 'ai', voice: 'kept' }, audioSources: { ai, raw } };
  engineCurrent = JSON.parse(JSON.stringify(stored));
  const response = await put({ text: 'AI corrected', mode: 'ai', expected: ai.chunks });
  expect(response.status).toBe(200);
  expect(written?.audioSources).toMatchObject({
    ai: { id: 'ai-source', revision: 8, chunks: [{ text: 'AI corrected' }] },
    raw: { id: 'raw-source', revision: 3, chunks: [{ text: 'Raw opening' }] },
  });
  expect(written?.audioChunks).toMatchObject([{ text: 'AI corrected' }]);
  expect(written?.audioMetadata).toMatchObject({ mode: 'ai', voice: 'kept' });
});

it('answers a refused store read during chunk correction without writing audio', async () => {
  __resetStoreAvailabilityForTests();
  const read = jest.spyOn(adminDb, 'collection').mockImplementationOnce(() => {
    throw Object.assign(new Error('Test store refusal'), { code: 8 });
  });
  try {
    const response = await put({ text: 'Kept correction', expected: [chunk('Polished opening')] });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ code: 'unavailable' });
    expect(writeOwnedDocument).not.toHaveBeenCalled();
    expect(written).toBeNull();
  } finally {
    read.mockRestore();
    __resetStoreAvailabilityForTests();
  }
});
