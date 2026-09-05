import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { collectNoteHeadings, GET, groundKeyPassage, MAX_CUT_CHARS, POST } from '@/api/studies/notes/[id]/cut/route';
import { UsageCapReachedError } from '@/services/usageLimits';
import { cutStudyNoteIntoScratch } from '@clients/studyNoteCut.structured';
import { studiesRepository } from '@repositories/studies.repository';

jest.mock('@/api/auth/requireAuthenticatedUid.server', () => ({
  getRequiredAuthenticatedUid: jest.fn(),
}));

jest.mock('@clients/studyNoteCut.structured', () => ({
  cutStudyNoteIntoScratch: jest.fn(),
}));

jest.mock('@repositories/studies.repository', () => ({
  studiesRepository: {
    getNote: jest.fn(),
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

const mockGetUid = getRequiredAuthenticatedUid as jest.Mock;
const mockGetNote = studiesRepository.getNote as jest.Mock;
const mockCut = cutStudyNoteIntoScratch as jest.Mock;

const request = (body: unknown = {}) => ({ json: jest.fn().mockResolvedValue(body) }) as unknown as Request;
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const ownNote = {
  id: 'note-1',
  userId: 'owner-1',
  title: 'Молитва Иависа',
  content: '## Раздел\n\nТекст с мыслью. *«стих»* (1 Пар 4:9-10)\n\n## Пустой раздел\n\nСвязка.',
  scriptureRefs: [{ book: '1 Chronicles', chapter: 4, fromVerse: 9, toVerse: 10, id: 'r1' }],
};

const goodCut = () => ({
  success: true,
  data: {
    keyPassage: '1 Пар 4:9-10',
    sections: [
      {
        heading: 'Раздел',
        claims: [
          { text: 'Мысль первая. «стих» (1 Пар 4:10)', scripture: '1 Пар 4:10' },
          { text: 'Мысль вторая без ссылки в тексте', scripture: 'Нав 14:12' },
        ],
      },
      { heading: 'Пустой раздел', claims: [] },
    ],
  },
  error: null,
});

describe('POST /api/studies/notes/:id/cut', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUid.mockResolvedValue('owner-1');
    mockGetNote.mockResolvedValue(ownNote);
    mockCut.mockResolvedValue(goodCut());
  });

  it('refuses without a signed-in caller', async () => {
    mockGetUid.mockResolvedValue(null);
    const response = await POST(request(), params('note-1'));
    expect(response.status).toBe(401);
    expect(mockCut).not.toHaveBeenCalled();
  });

  it('refuses an unsaved note before touching the model', async () => {
    const response = await POST(request(), params('new'));
    expect(response.status).toBe(400);
    expect(mockGetNote).not.toHaveBeenCalled();
    expect(mockCut).not.toHaveBeenCalled();
  });

  it('answers 404 when the note does not exist', async () => {
    mockGetNote.mockResolvedValue(null);
    const response = await POST(request(), params('missing'));
    expect(response.status).toBe(404);
    expect(mockCut).not.toHaveBeenCalled();
  });

  it("refuses someone else's note before loading it into a prompt", async () => {
    mockGetNote.mockResolvedValue({ ...ownNote, userId: 'someone-else' });
    const response = await POST(request(), params('note-1'));
    expect(response.status).toBe(403);
    expect(mockCut).not.toHaveBeenCalled();
  });

  it('refuses a note without text', async () => {
    mockGetNote.mockResolvedValue({ ...ownNote, content: '   ' });
    const response = await POST(request(), params('note-1'));
    expect(response.status).toBe(400);
    expect(mockCut).not.toHaveBeenCalled();
  });

  it('refuses a note too long for one cut up front, instead of dying at the function wall', async () => {
    mockGetNote.mockResolvedValue({ ...ownNote, content: 'x'.repeat(MAX_CUT_CHARS + 1) });
    const response = await POST(request(), params('note-1'));
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ limit: MAX_CUT_CHARS });
    expect(mockCut).not.toHaveBeenCalled();
  });

  it('turns a usage cap into a 429 the client understands', async () => {
    mockCut.mockRejectedValue(new UsageCapReachedError('ai', 10, 10, 10, '2026-09-06T00:00:00.000Z'));
    const response = await POST(request(), params('note-1'));
    expect(response.status).toBe(429);
  });

  it("reports a failed cut as a server error, with the cutter's reason", async () => {
    mockCut.mockResolvedValue({ success: false, data: null, error: 'Model refused' });
    const response = await POST(request(), params('note-1'));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ success: false, error: 'Model refused' });
  });

  it('refuses to call an empty cut a success', async () => {
    mockCut.mockResolvedValue({ success: true, data: { keyPassage: '', sections: [{ heading: 'Раздел', claims: [] }] }, error: null });
    const response = await POST(request(), params('note-1'));
    expect(response.status).toBe(422);
  });

  it('answers atoms ready for a sermon, each carrying its Scripture and origin, plus the per-section count', async () => {
    const response = await POST(request(), params('note-1'));
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.success).toBe(true);
    expect(body.noteId).toBe('note-1');
    expect(body.keyPassage).toBe('1 Пар 4:9-10');
    expect(body.sections).toEqual([
      { heading: 'Раздел', count: 2 },
      { heading: 'Пустой раздел', count: 0 },
    ]);

    expect(body.notes).toHaveLength(2);
    const [first, second] = body.notes;
    expect(first.text).toBe('Мысль первая. «стих» (1 Пар 4:10)');
    // A reference the model kept apart is folded into the text, so the card can be preached from alone.
    expect(second.text).toBe('Мысль вторая без ссылки в тексте (Нав 14:12)');
    for (const note of body.notes) {
      expect(typeof note.id).toBe('string');
      expect(note.id.length).toBeGreaterThan(0);
      expect(note.source).toEqual({ noteId: 'note-1', heading: 'Раздел' });
    }
    expect(new Set(body.notes.map((note: { id: string }) => note.id)).size).toBe(2);
    // Reading order survives: timestamps strictly increase, so a time-ordered board
    // and the composer see the note's argument in the order it was written.
    expect(new Date(second.createdAt).getTime()).toBeGreaterThan(new Date(first.createdAt).getTime());

    // The cutter is told who pays and what the author attached, formatted for reading.
    expect(mockCut).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'owner-1',
        title: 'Молитва Иависа',
        scriptureRefs: ['1 Chronicles 4:9-10'],
      })
    );
  });

  it('does not store a heading or a key passage the note never wrote', async () => {
    const cut = goodCut();
    cut.data.keyPassage = 'Ин 3:16';
    cut.data.sections[0].heading = 'Выдуманный раздел';
    mockCut.mockResolvedValue(cut);
    const response = await POST(request(), params('note-1'));
    const body = await response.json();
    expect(body.keyPassage).toBe('');
    expect(body.sections[0]).toEqual({ heading: '', count: 2 });
    expect(body.notes[0].source).toEqual({ noteId: 'note-1', heading: '' });
  });
});

describe('grounding helpers', () => {
  it('collects headings as written, ignoring emphasis and fenced code', () => {
    const headings = collectNoteHeadings('# **Первая** тема\ntext\n```\n# not a heading\n```\n## Вторая ##\n');
    expect(Array.from(headings.values())).toEqual(['Первая тема', 'Вторая']);
  });

  it('keeps a key passage only when the note contains it', () => {
    const content = 'Иавис воззвал (1 Пар   4:9-10) и получил.';
    expect(groundKeyPassage('1 Пар 4:9-10', content)).toBe('1 Пар 4:9-10');
    expect(groundKeyPassage('Ин 3:16', content)).toBe('');
    expect(groundKeyPassage('   ', content)).toBe('');
  });
});

describe('GET /api/studies/notes/[id]/cut — the plan, before any model is called', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUid.mockResolvedValue('owner-1');
    mockGetNote.mockResolvedValue(ownNote);
  });

  it('answers the sections the author wrote and the requests they will take', async () => {
    const response = await GET(request(), params('note-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.totalSections).toBe(2);
    expect(body.sections.map((section: { heading: string }) => section.heading)).toEqual(['Раздел', 'Пустой раздел']);
    expect(body.slices).toEqual([{ offset: 0, limit: 2, words: expect.any(Number) }]);
    // The plan costs nothing: the model is not called to find out what the note contains.
    expect(mockCut).not.toHaveBeenCalled();
  });

  it('refuses the same things the cut refuses, before telling anyone what is inside', async () => {
    mockGetUid.mockResolvedValueOnce(null);
    expect((await GET(request(), params('note-1'))).status).toBe(401);

    mockGetNote.mockResolvedValueOnce({ ...ownNote, userId: 'someone-else' });
    expect((await GET(request(), params('note-1'))).status).toBe(403);

    mockGetNote.mockResolvedValueOnce({ ...ownNote, content: 'x'.repeat(MAX_CUT_CHARS + 1) });
    expect((await GET(request(), params('note-1'))).status).toBe(413);
  });
});

describe('POST — cutting one slice of the note', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUid.mockResolvedValue('owner-1');
    mockGetNote.mockResolvedValue(ownNote);
    mockCut.mockResolvedValue(goodCut());
  });

  it('hands the model only the sections asked for, and says which part of the note they are', async () => {
    const response = await POST(request({ offset: 1, limit: 1 }), params('note-1'));
    const body = await response.json();

    const passed = mockCut.mock.calls[0][0];
    expect(passed.content).toBe('## Пустой раздел\n\nСвязка.');
    expect(passed.content).not.toContain('Текст с мыслью');
    expect(passed.slice).toEqual({ from: 2, to: 2, total: 2 });
    // A budget under the 60s wall, so the cutter knows whether a retry still fits.
    expect(passed.budgetMs).toBeLessThanOrEqual(50_000);
    expect(body.totalSections).toBe(2);
    expect(body.offset).toBe(1);
    expect(body.limit).toBe(1);
  });

  it('cuts the whole note when no slice is asked for, and says nothing about excerpts', async () => {
    await POST(request({}), params('note-1'));
    const passed = mockCut.mock.calls[0][0];
    expect(passed.content).toContain('Текст с мыслью');
    expect(passed.content).toContain('Связка.');
    expect(passed.slice).toBeUndefined();
  });

  it('refuses a slice that is not in the note instead of cutting something else', async () => {
    const response = await POST(request({ offset: 9, limit: 2 }), params('note-1'));
    expect(response.status).toBe(400);
    expect(mockCut).not.toHaveBeenCalled();
  });
});
