import { PUT } from '@/api/sermons/[id]/audio/chunks/route';
import { writeOwnedDocument } from '@/data-engine/serverEdit.server';

import type { NextRequest } from 'next/server';

/**
 * A SOURCE SWITCH WRITES A WHOLE ARRAY FROM THE CLIENT'S CACHE (BUG-20260810-audio-chunks-whole-array).
 *
 * The cache can be older than the database — a chunk corrected on another device after this one
 * built it. The write must land only while the database still holds the set the client last saw.
 */
let stored: Record<string, unknown> = {};
let engineCurrent: Record<string, unknown> = {};
let written: Record<string, unknown> | null = null;

jest.mock('next/server', () => ({
  NextResponse: { json: jest.fn((data: unknown, init: { status?: number } = {}) => ({ status: init.status ?? 200, json: async () => data })) },
}));
jest.mock('@/api/auth/requireAuthenticatedUid.server', () => ({ getRequiredAuthenticatedUid: jest.fn().mockResolvedValue('owner-1') }));
jest.mock('@/config/firebaseAdminConfig', () => ({
  adminDb: { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => stored }) }) }) },
}));
jest.mock('@/data-engine/legacyBoundary.server', () => ({
  ...jest.requireActual('@/data-engine/legacyBoundary.server'),
  updateLegacyDocument: jest.fn(),
}));
jest.mock('@/data-engine/serverEdit.server', () => ({
  ...jest.requireActual('@/data-engine/serverEdit.server'),
  assertServerWritable: jest.fn(),
  // The engine road: the route's own change applied to what the engine reads now.
  writeOwnedDocument: jest.fn(async ({ engine }: { engine: (current: Record<string, unknown>) => Record<string, unknown> }) => {
    written = engine(JSON.parse(JSON.stringify(engineCurrent)));
    return written;
  }),
}));

const chunk = (index: number, text: string) => ({ sectionId: 'introduction', index, text, createdAt: '2026-09-01T00:00:00.000Z' });
const raw = [chunk(0, 'Raw opening')];
const ai = [chunk(0, 'Polished opening')];
const put = (body: unknown) => PUT(
  { json: async () => body } as unknown as NextRequest,
  { params: Promise.resolve({ id: 's1' }) },
);

beforeEach(() => {
  written = null;
  stored = { userId: 'owner-1', audioChunks: raw, audioMetadata: { mode: 'raw' } };
  engineCurrent = stored;
  jest.mocked(writeOwnedDocument).mockClear();
});

it('writes the cached set while the database holds the set the client last saw', async () => {
  // A client preview field on the expected set is bookkeeping, not a difference.
  const response = await put({ chunks: ai, mode: 'ai', expected: raw.map(c => ({ ...c, preview: c.text })) });
  expect(response.status).toBe(200);
  expect(written?.audioChunks).toEqual(ai);
  expect((written?.audioMetadata as { mode: string }).mode).toBe('ai');
});

it('reads an absent kind as body, the shape the optimize route answers with', async () => {
  // Stored as prepared (no kind); expected as the client got it back from optimize (kind: 'body').
  const response = await put({ chunks: ai, mode: 'ai', expected: raw.map(c => ({ ...c, kind: 'body' })) });
  expect(response.status).toBe(200);
});

it('answers with what is stored instead of writing over a set changed elsewhere', async () => {
  stored = { userId: 'owner-1', audioChunks: [chunk(0, 'Corrected on the phone')], audioMetadata: { mode: 'ai' } };
  engineCurrent = stored;
  const response = await put({ chunks: ai, mode: 'ai', expected: raw });
  expect(response.status).toBe(409);
  const body = await response.json();
  expect(body).toMatchObject({ code: 'chunks-changed', mode: 'ai' });
  expect(body.chunks[0].text).toBe('Corrected on the phone');
  expect(writeOwnedDocument).not.toHaveBeenCalled();
});

it('catches a change that lands between the check and the write', async () => {
  engineCurrent = { ...stored, audioChunks: [chunk(0, 'Corrected a moment later')], audioMetadata: { mode: 'raw' } };
  const response = await put({ chunks: ai, mode: 'ai', expected: raw });
  expect(response.status).toBe(409);
  expect((await response.json()).chunks[0].text).toBe('Corrected a moment later');
  expect(written).toBeNull();
});

it('keeps the old behaviour for a client that sends no expected set', async () => {
  stored = { userId: 'owner-1', audioChunks: [chunk(0, 'Anything')], audioMetadata: { mode: 'raw' } };
  engineCurrent = stored;
  const response = await put({ chunks: ai, mode: 'ai' });
  expect(response.status).toBe(200);
  expect(written?.audioChunks).toEqual(ai);
});

it('stores the chunk shape the engine accepts, whatever the client cached', async () => {
  // The optimize route used to answer without createdAt, and the engine refuses such a set whole.
  const response = await put({ chunks: [{ sectionId: 'introduction', index: 0, text: 'Polished opening', preview: 'Polished…' }], mode: 'ai', expected: raw });
  expect(response.status).toBe(200);
  const [storedChunk] = written?.audioChunks as Array<Record<string, unknown>>;
  expect(typeof storedChunk.createdAt).toBe('string');
  expect(storedChunk).not.toHaveProperty('preview');
});
