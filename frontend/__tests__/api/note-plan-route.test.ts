import { NextRequest } from 'next/server';

import { POST } from '@/api/sermons/[id]/plan/route';
import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { sermonsRepository } from '@/api/repositories/sermons.repository';
import { studiesRepository } from '@/api/repositories/studies.repository';
import { generateNotePlanPoint } from '@/api/clients/openAI.client';
import { notePlanContextKey } from '@/utils/notePlan';

import type { Sermon } from '@/models/models';

jest.mock('@/api/auth/requireAuthenticatedUid.server');
jest.mock('@/api/repositories/sermons.repository', () => ({ sermonsRepository: { fetchSermonById: jest.fn() } }));
jest.mock('@/api/repositories/studies.repository', () => ({ studiesRepository: { getNote: jest.fn() } }));
jest.mock('@/api/clients/openAI.client', () => ({ generateNotePlanPoint: jest.fn() }));
jest.mock('next/server', () => ({ NextResponse: { json: (body: unknown, init: ResponseInit = {}) => ({
  status: init.status ?? 200, headers: new Headers(init.headers), json: async () => body,
}) } }));

const sermon: Sermon = {
  id: 's', userId: 'u', title: 'Title', verse: 'John 10', date: '', thoughts: [], sourceNoteIds: ['n'],
  outline: { introduction: [], main: [{ id: 'p', text: 'Point', note: 'List the examples', subPoints: [{ id: 'sub', text: 'Detail', position: 0, note: 'Use the contrast' }] }], conclusion: [] },
};
const note = { id: 'n', userId: 'u', title: 'Study', content: 'The full original study', scriptureRefs: [{ book: 'John', chapter: 10 }] };
const params = { params: Promise.resolve({ id: 's' }) };
const request = (body: unknown = { outlinePointId: 'p', style: 'memory', expectedContext: notePlanContextKey(sermon, 'p') }) => ({ json: async () => body }) as NextRequest;

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(getRequiredAuthenticatedUid).mockResolvedValue('u');
  jest.mocked(sermonsRepository.fetchSermonById).mockResolvedValue(sermon);
  jest.mocked(studiesRepository.getNote).mockResolvedValue(note as never);
  jest.mocked(generateNotePlanPoint).mockResolvedValue({ contentByNodeId: { p: '- Cue', sub: '- Detail' }, missingMaterial: {} });
});

it('generates without thoughts from the full trusted study and node reminders, without writing', async () => {
  const response = await POST(request(), params);
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toContain('no-store');
  expect(await response.json()).toEqual({ contentByNodeId: { p: '- Cue', sub: '- Detail' }, missingMaterial: {} });
  expect(generateNotePlanPoint).toHaveBeenCalledWith(expect.objectContaining({
    point: sermon.outline!.main[0], thoughts: [],
    notes: [expect.objectContaining({ content: note.content, scriptureRefs: [JSON.stringify(note.scriptureRefs[0])] })],
  }), 'memory', 'u');
});

it.each([
  ['unauthenticated', 401], ['foreignSermon', 403], ['absentSermon', 404],
  ['invalid', 400], ['missingPoint', 404], ['changedContext', 409],
  ['missingSource', 422], ['foreignSource', 422], ['emptySource', 422], ['unlinked', 422], ['large', 413],
])('refuses %s before contacting AI', async (kind, status) => {
  let req = request();
  if (kind === 'unauthenticated') jest.mocked(getRequiredAuthenticatedUid).mockResolvedValue(null);
  if (kind === 'foreignSermon') jest.mocked(sermonsRepository.fetchSermonById).mockResolvedValue({ ...sermon, userId: 'other' });
  if (kind === 'absentSermon') jest.mocked(sermonsRepository.fetchSermonById).mockResolvedValue(null as never);
  if (kind === 'invalid') req = request({ style: 'invented' });
  if (kind === 'missingPoint') req = request({ outlinePointId: 'missing', style: 'memory', expectedContext: 'old' });
  if (kind === 'changedContext') req = request({ outlinePointId: 'p', style: 'memory', expectedContext: 'old' });
  if (kind === 'missingSource') jest.mocked(studiesRepository.getNote).mockResolvedValue(null);
  if (kind === 'foreignSource') jest.mocked(studiesRepository.getNote).mockResolvedValue({ ...note, userId: 'other' } as never);
  if (kind === 'emptySource') jest.mocked(studiesRepository.getNote).mockResolvedValue({ ...note, content: ' ' } as never);
  if (kind === 'large') jest.mocked(studiesRepository.getNote).mockResolvedValue({ ...note, content: 'x'.repeat(200_001) } as never);
  if (kind === 'unlinked') {
    const unlinked = { ...sermon, sourceNoteIds: [] };
    jest.mocked(sermonsRepository.fetchSermonById).mockResolvedValue(unlinked);
    req = request({ outlinePointId: 'p', style: 'memory', expectedContext: notePlanContextKey(unlinked, 'p') });
  }
  expect((await POST(req, params)).status).toBe(status);
  expect(generateNotePlanPoint).not.toHaveBeenCalled();
});

it('refuses a proposal if the source changes during generation', async () => {
  jest.mocked(studiesRepository.getNote).mockResolvedValueOnce(note as never).mockResolvedValue({ ...note, content: 'Revised study' } as never);
  expect((await POST(request(), params)).status).toBe(409);
});

it('reports provider failure and malformed JSON', async () => {
  jest.mocked(generateNotePlanPoint).mockRejectedValue(new Error('failed'));
  expect((await POST(request(), params)).status).toBe(500);
  expect((await POST({ json: async () => { throw new SyntaxError(); } } as unknown as NextRequest, params)).status).toBe(400);
});

it('passes an owned subpoint target through without widening its scope', async () => {
  jest.mocked(generateNotePlanPoint).mockResolvedValue({ contentByNodeId: { sub: '- Selected detail' }, missingMaterial: {} });
  const response = await POST(request({ outlinePointId: 'p', targetNodeId: 'sub', style: 'memory', expectedContext: notePlanContextKey(sermon, 'p') }), params);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ contentByNodeId: { sub: '- Selected detail' }, missingMaterial: {} });
  expect(generateNotePlanPoint).toHaveBeenCalledWith(expect.objectContaining({ targetNodeId: 'sub', point: sermon.outline!.main[0] }), 'memory', 'u');
});

it.each(['foreign', ''])('rejects an invalid subpoint target %p before AI', async (targetNodeId) => {
  const response = await POST(request({ outlinePointId: 'p', targetNodeId, style: 'memory', expectedContext: notePlanContextKey(sermon, 'p') }), params);
  expect(response.status).toBe(targetNodeId ? 404 : 400);
  expect(generateNotePlanPoint).not.toHaveBeenCalled();
});
