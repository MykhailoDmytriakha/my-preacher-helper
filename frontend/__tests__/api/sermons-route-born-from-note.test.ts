/**
 * POST /api/sermons when the sermon is BORN FROM A STUDY NOTE.
 *
 * The create may carry the provenance link and the atoms cut from the note, and the
 * route must treat both as claims to verify, not data to copy: the link only to notes the
 * caller owns, the scratch list whitelisted field by field, an atom's origin only to a
 * verified note, and the answer the exact committed representation.
 */
import { adminDb } from '@/config/firebaseAdminConfig';
import { studiesRepository } from '@/api/repositories/studies.repository';

jest.mock('@/config/firebaseAdminConfig', () => ({
  adminDb: {
    collection: jest.fn(),
  },
}));

jest.mock('next/server', () => ({
  NextResponse: {
    json: jest.fn().mockImplementation((data, options = {}) => ({
      status: options.status || 200,
      json: async () => data,
    })),
  },
}));

jest.mock('@/api/repositories/series.repository', () => ({
  seriesRepository: { addSermonToSeries: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('@/api/repositories/studies.repository', () => ({
  studiesRepository: { getNote: jest.fn() },
}));

jest.mock('@/api/auth/requireAuthenticatedUid.server', () => ({
  getRequiredAuthenticatedUid: jest.fn().mockResolvedValue('user123'),
}));

import * as sermonsRouteModule from 'app/api/sermons/route';

const mockGetNote = studiesRepository.getNote as jest.Mock;

const baseBody = { title: 'Иавис', verse: '1 Пар 4:9-10', date: '2026-09-05T00:00:00.000Z' };

describe('POST /api/sermons born from a study note', () => {
  let mockAdd: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAdd = jest.fn().mockResolvedValue({ id: 'sermon-new' });
    const mockDoc = jest.fn().mockImplementation((id: string) => ({
      id,
      get: jest.fn().mockResolvedValue({ exists: false }),
      set: jest.fn().mockResolvedValue(undefined),
    }));
    (adminDb as unknown as { collection: jest.Mock }).collection.mockImplementation(() => ({ add: mockAdd, doc: mockDoc }));
    mockGetNote.mockResolvedValue({ id: 'note-1', userId: 'user123', content: 'x' });
  });

  const post = (body: Record<string, unknown>) =>
    sermonsRouteModule.POST({ json: jest.fn().mockResolvedValue(body) } as unknown as Request);

  it("writes the link and the atoms when the note is the caller's own, and answers what it wrote", async () => {
    const response = await post({
      ...baseBody,
      sourceNoteIds: ['note-1'],
      scratch: [
        { id: 'a1', text: 'Мысль. (1 Пар 4:10)', createdAt: '2026-09-05T00:00:01.000Z', source: { noteId: 'note-1', heading: 'Раздел' }, extra: 'dropped' },
        { id: 'a2', text: 'Вторая мысль', createdAt: '2026-09-05T00:00:02.000Z', section: 'conclusion' },
        { id: 'a3', text: '   ', createdAt: '2026-09-05T00:00:03.000Z' },
        { id: 'a1', text: 'Дубль id получает новый id', createdAt: '2026-09-05T00:00:04.000Z' },
      ],
    });

    expect(response.status).toBe(200);
    expect(mockGetNote).toHaveBeenCalledWith('note-1');
    const written = mockAdd.mock.calls[0][0];
    expect(written.sourceNoteIds).toEqual(['note-1']);
    expect(written.scratch).toHaveLength(3);
    expect(written.scratch[0]).toEqual({
      id: 'a1',
      text: 'Мысль. (1 Пар 4:10)',
      createdAt: '2026-09-05T00:00:01.000Z',
      source: { noteId: 'note-1', heading: 'Раздел' },
    });
    expect(written.scratch[1]).toEqual({
      id: 'a2',
      text: 'Вторая мысль',
      createdAt: '2026-09-05T00:00:02.000Z',
      section: 'conclusion',
    });
    expect(written.scratch[2].text).toBe('Дубль id получает новый id');
    expect(written.scratch[2].id).not.toBe('a1');
    expect(written.updatedAt).toEqual(expect.any(String));

    // The answer is the committed representation, not an echo of the request: the client
    // seeds its caches from it, and a copy that differs from the document is a second truth.
    const body = await response.json();
    expect(body.sermon.id).toBe('sermon-new');
    expect(body.sermon.scratch).toEqual(written.scratch);
    expect(body.sermon.sourceNoteIds).toEqual(['note-1']);
    expect(body.sermon.updatedAt).toBe(written.updatedAt);
    expect(body.sermon.scratch[0]).not.toHaveProperty('extra');
  });

  it("refuses a link to someone else's note", async () => {
    mockGetNote.mockResolvedValue({ id: 'note-1', userId: 'other' });
    const response = await post({ ...baseBody, sourceNoteIds: ['note-1'] });
    expect(response.status).toBe(403);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('refuses a link to a note that does not exist', async () => {
    mockGetNote.mockResolvedValue(null);
    const response = await post({ ...baseBody, sourceNoteIds: ['ghost'] });
    expect(response.status).toBe(403);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('refuses a malformed sourceNoteIds', async () => {
    const response = await post({ ...baseBody, sourceNoteIds: 'note-1' });
    expect(response.status).toBe(400);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('writes neither key when the create carries no note, and answers without them', async () => {
    const response = await post(baseBody);
    expect(response.status).toBe(200);
    const written = mockAdd.mock.calls[0][0];
    expect(written).not.toHaveProperty('sourceNoteIds');
    expect(written).not.toHaveProperty('scratch');
    expect(mockGetNote).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body.sermon).not.toHaveProperty('sourceNoteIds');
    expect(body.sermon).not.toHaveProperty('scratch');
  });

  it("drops an atom's origin that names a note the sermon is not linked to, keeping the atom", async () => {
    const response = await post({
      ...baseBody,
      sourceNoteIds: ['note-1'],
      scratch: [
        { id: 'a1', text: 'своя', createdAt: 'x', source: { noteId: 'note-1', heading: 'H' } },
        { id: 'a2', text: 'чужая провенанс', createdAt: 'x', source: { noteId: 'someone-elses-note', heading: 'H' } },
      ],
    });
    expect(response.status).toBe(200);
    const written = mockAdd.mock.calls[0][0];
    expect(written.scratch[0].source).toEqual({ noteId: 'note-1', heading: 'H' });
    expect(written.scratch[1]).not.toHaveProperty('source');
    expect(written.scratch[1].text).toBe('чужая провенанс');
  });

  it('refuses, rather than truncates, a create carrying more atoms than a document may be born with', async () => {
    const scratch = Array.from({ length: 301 }, (_, index) => ({ id: `n${index}`, text: `t${index}`, createdAt: 'x' }));
    const response = await post({ ...baseBody, scratch });
    expect(response.status).toBe(400);
    expect(mockAdd).not.toHaveBeenCalled();

    const exactly = Array.from({ length: 300 }, (_, index) => ({ id: `n${index}`, text: `t${index}`, createdAt: 'x' }));
    const ok = await post({ ...baseBody, scratch: exactly });
    expect(ok.status).toBe(200);
    expect(mockAdd.mock.calls[0][0].scratch).toHaveLength(300);
  });
});
