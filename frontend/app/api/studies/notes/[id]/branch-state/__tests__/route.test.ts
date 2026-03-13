import { GET, PUT } from '../route';
import { studiesRepository } from '@repositories/studies.repository';

jest.mock('next/server', () => ({
    NextResponse: {
        json: jest.fn((body, init) => ({
            status: init?.status || 200,
            json: async () => body,
        })),
    },
}));

jest.mock('@repositories/studies.repository', () => ({
    studiesRepository: {
        getNote: jest.fn(),
        getNoteBranchState: jest.fn(),
        upsertNoteBranchState: jest.fn(),
    },
}));

const createRequest = (url: string, method: string = 'GET', body?: unknown) => new Request(url, {
    method,
    body: body ? JSON.stringify(body) : undefined,
});

describe('Study Note Branch State Route', () => {
    const userId = 'user-1';
    const noteId = 'note-1';
    const mockNote = {
        id: noteId,
        userId,
        content: '## Main Branch',
        scriptureRefs: [],
        tags: [],
        createdAt: '2026-03-12T00:00:00.000Z',
        updatedAt: '2026-03-12T00:00:00.000Z',
        isDraft: false,
    };
    const mockBranchState = {
        id: noteId,
        noteId,
        userId,
        branchRecords: [
            {
                branchId: 'branch-1',
                title: 'Main Branch',
                titleSlug: 'main-branch',
                parentSlugChain: [],
                bodyHash: 'body-hash',
                subtreeHash: 'subtree-hash',
                subtreeContentHash: 'subtree-content-hash',
                subtreeOccurrenceIndex: 0,
                contextualOccurrenceIndex: 0,
                relaxedOccurrenceIndex: 0,
                contextualContentOccurrenceIndex: 0,
                relaxedContentOccurrenceIndex: 0,
                lastKnownKey: '1',
            },
        ],
        readFoldedBranchIds: ['branch-1'],
        previewFoldedBranchIds: [],
        createdAt: '2026-03-12T00:00:00.000Z',
        updatedAt: '2026-03-12T00:00:00.000Z',
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns 401 when userId is missing', async () => {
        const response = await GET(
            createRequest(`http://localhost/api/studies/notes/${noteId}/branch-state`),
            { params: Promise.resolve({ id: noteId }) }
        );
        const data = await response.json();

        expect(response.status).toBe(401);
        expect(data.error).toBe('User not authenticated');
    });

    it('returns the branch state for the note owner', async () => {
        (studiesRepository.getNote as jest.Mock).mockResolvedValue(mockNote);
        (studiesRepository.getNoteBranchState as jest.Mock).mockResolvedValue(mockBranchState);

        const response = await GET(
            createRequest(`http://localhost/api/studies/notes/${noteId}/branch-state?userId=${userId}`),
            { params: Promise.resolve({ id: noteId }) }
        );
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(studiesRepository.getNoteBranchState).toHaveBeenCalledWith(noteId);
        expect(data).toEqual(mockBranchState);
    });

    it('saves the branch state for the note owner', async () => {
        (studiesRepository.getNote as jest.Mock).mockResolvedValue(mockNote);
        (studiesRepository.upsertNoteBranchState as jest.Mock).mockResolvedValue(mockBranchState);

        const response = await PUT(
            createRequest(`http://localhost/api/studies/notes/${noteId}/branch-state?userId=${userId}`, 'PUT', {
                branchRecords: mockBranchState.branchRecords,
                readFoldedBranchIds: mockBranchState.readFoldedBranchIds,
                previewFoldedBranchIds: mockBranchState.previewFoldedBranchIds,
            }),
            { params: Promise.resolve({ id: noteId }) }
        );
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(studiesRepository.upsertNoteBranchState).toHaveBeenCalledWith(noteId, {
            userId,
            branchRecords: mockBranchState.branchRecords,
            readFoldedBranchIds: ['branch-1'],
            previewFoldedBranchIds: [],
        });
        expect(data).toEqual(mockBranchState);
    });
});
