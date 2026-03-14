import { GET } from '../route';
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
        listNoteBranchStates: jest.fn(),
    },
}));

const createRequest = (url: string) => new Request(url);

describe('Study Note Branch States Route', () => {
    const userId = 'user-1';
    const mockStates = [
        {
            id: 'note-1',
            noteId: 'note-1',
            userId,
            branchRecords: [],
            readFoldedBranchIds: [],
            previewFoldedBranchIds: [],
            createdAt: '2026-03-13T00:00:00.000Z',
            updatedAt: '2026-03-13T00:00:00.000Z',
        },
    ];

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns 401 when userId is missing', async () => {
        const response = await GET(createRequest('http://localhost/api/studies/notes/branch-states'));
        const data = await response.json();

        expect(response.status).toBe(401);
        expect(data.error).toBe('User not authenticated');
    });

    it('returns all branch states for the user', async () => {
        (studiesRepository.listNoteBranchStates as jest.Mock).mockResolvedValue(mockStates);

        const response = await GET(
            createRequest(`http://localhost/api/studies/notes/branch-states?userId=${userId}`)
        );
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(studiesRepository.listNoteBranchStates).toHaveBeenCalledWith(userId);
        expect(data).toEqual(mockStates);
    });

    it('returns 500 when repository fails', async () => {
        (studiesRepository.listNoteBranchStates as jest.Mock).mockRejectedValue(new Error('boom'));

        const response = await GET(
            createRequest(`http://localhost/api/studies/notes/branch-states?userId=${userId}`)
        );
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.error).toBe('Failed to fetch study note branch states');
    });
});
