import { PUT } from '@/api/sermons/[id]/audio/chunks/[index]/route';
import { writeOwnedDocument } from '@/data-engine/serverEdit.server';

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
