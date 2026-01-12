import { GET, POST } from '../route';
import { studiesRepository } from '@repositories/studies.repository';
import { StudyNote } from '@/models/models';

// Mock the NextResponse
jest.mock('next/server', () => ({
    NextResponse: {
        json: jest.fn((body, init) => {
            return {
                status: init?.status || 200,
                json: async () => body,
            };
        }),
    },
}));

// Mock the repository
jest.mock('@repositories/studies.repository', () => ({
    studiesRepository: {
        listNotes: jest.fn(),
        createNote: jest.fn(),
    },
}));

// Helper to create a Request object
const createRequest = (url: string, method: string = 'GET', body?: any) => {
    return new Request(url, {
        method,
        body: body ? JSON.stringify(body) : undefined,
    });
};

describe('Study Notes API Route', () => {
    const userId = 'test-user-123';
    const mockNotes: StudyNote[] = [
        {
            id: '1',
            userId,
            title: 'Note One',
            content: 'Content about faith',
            tags: ['faith'],
            scriptureRefs: [{ id: 'ref1', book: 'Hebrews', chapter: 11, fromVerse: 1 }],
            type: 'note',
            createdAt: '2023-01-01T00:00:00Z',
            updatedAt: '2023-01-01T00:00:00Z',
            isDraft: false,
            materialIds: [],
            relatedSermonIds: [],
        },
        {
            id: '2',
            userId,
            title: 'Question Two',
            content: 'How to pray?',
            tags: ['prayer'],
            scriptureRefs: [],
            type: 'question',
            createdAt: '2023-01-02T00:00:00Z',
            updatedAt: '2023-01-02T00:00:00Z',
            isDraft: true,
            materialIds: [],
            relatedSermonIds: [],
        },
    ];

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('GET', () => {
        it('returns 401 if userId is missing', async () => {
            const req = createRequest('http://localhost/api/studies/notes');
            const response = await GET(req);
            const data = await response.json();

            expect(response.status).toBe(401);
            expect(data.error).toBe('User not authenticated');
        });

        it('returns all notes for a user', async () => {
            (studiesRepository.listNotes as jest.Mock).mockResolvedValue(mockNotes);
            const req = createRequest(`http://localhost/api/studies/notes?userId=${userId}`);
            const response = await GET(req);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data).toHaveLength(2);
            expect(studiesRepository.listNotes).toHaveBeenCalledWith(userId);
        });

        it('filters notes by search query', async () => {
            (studiesRepository.listNotes as jest.Mock).mockResolvedValue(mockNotes);
            const req = createRequest(`http://localhost/api/studies/notes?userId=${userId}&q=pray`);
            const response = await GET(req);
            const data = await response.json();

            expect(data).toHaveLength(1);
            expect(data[0].id).toBe('2');
        });

        it('filters notes by tag', async () => {
            (studiesRepository.listNotes as jest.Mock).mockResolvedValue(mockNotes);
            const req = createRequest(`http://localhost/api/studies/notes?userId=${userId}&tag=faith`);
            const response = await GET(req);
            const data = await response.json();

            expect(data).toHaveLength(1);
            expect(data[0].id).toBe('1');
        });

        it('filters notes by book', async () => {
            (studiesRepository.listNotes as jest.Mock).mockResolvedValue(mockNotes);
            const req = createRequest(`http://localhost/api/studies/notes?userId=${userId}&book=Hebrews`);
            const response = await GET(req);
            const data = await response.json();

            expect(data).toHaveLength(1);
            expect(data[0].id).toBe('1');
        });

        it('filters notes by chapter', async () => {
            (studiesRepository.listNotes as jest.Mock).mockResolvedValue(mockNotes);
            const req = createRequest(`http://localhost/api/studies/notes?userId=${userId}&chapter=11`);
            const response = await GET(req);
            const data = await response.json();

            expect(data).toHaveLength(1);
            expect(data[0].id).toBe('1');
        });

        it('filters drafts only', async () => {
            (studiesRepository.listNotes as jest.Mock).mockResolvedValue(mockNotes);
            const req = createRequest(`http://localhost/api/studies/notes?userId=${userId}&draftOnly=true`);
            const response = await GET(req);
            const data = await response.json();

            expect(data).toHaveLength(1);
            expect(data[0].id).toBe('2');
        });

        it('returns 500 if repository fails', async () => {
            (studiesRepository.listNotes as jest.Mock).mockRejectedValue(new Error('DB Error'));
            const req = createRequest(`http://localhost/api/studies/notes?userId=${userId}`);
            const response = await GET(req);
            const data = await response.json();

            expect(response.status).toBe(500);
            expect(data.error).toBe('Failed to fetch study notes');
        });
    });

    describe('POST', () => {
        const validPayload = {
            userId: 'test-user',
            content: 'Test content',
            title: 'Test Title',
            type: 'question',
            tags: ['test'],
        };

        it('returns 400 if userId or content is missing', async () => {
            const req = createRequest('http://localhost/api/studies/notes', 'POST', { userId: '123' });
            const response = await POST(req);
            const data = await response.json();

            expect(response.status).toBe(400);
            expect(data.error).toBe('userId and content are required');
        });

        it('creates a new note with correctly passed type', async () => {
            const mockCreatedNote = { ...validPayload, id: 'new-id', createdAt: '', updatedAt: '', isDraft: false, scriptureRefs: [], materialIds: [], relatedSermonIds: [] };
            (studiesRepository.createNote as jest.Mock).mockResolvedValue(mockCreatedNote);

            const req = createRequest('http://localhost/api/studies/notes', 'POST', validPayload);
            const response = await POST(req);
            const data = await response.json();

            expect(response.status).toBe(201);
            expect(studiesRepository.createNote).toHaveBeenCalledWith(expect.objectContaining({
                userId: validPayload.userId,
                content: validPayload.content,
                type: 'question', // CRITICAL: verify the fix is tested
            }));
            expect(data.id).toBe('new-id');
        });

        it('returns 500 if creation fails', async () => {
            (studiesRepository.createNote as jest.Mock).mockRejectedValue(new Error('Save failed'));
            const req = createRequest('http://localhost/api/studies/notes', 'POST', validPayload);
            const response = await POST(req);
            const data = await response.json();

            expect(response.status).toBe(500);
            expect(data.error).toBe('Failed to create study note');
        });
    });
});
