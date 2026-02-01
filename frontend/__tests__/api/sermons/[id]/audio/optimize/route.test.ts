
import { POST } from '@/api/sermons/[id]/audio/optimize/route';
import { adminDb } from '@/config/firebaseAdminConfig';
import { optimizeTextForSpeech } from '@/api/clients/speechOptimization.client';
import { createAudioChunks } from '@/api/clients/tts.client';

// Mock Next.js Server objects
jest.mock('next/server', () => {
    return {
        NextRequest: class {
            url: string;
            body: any;
            constructor(url: string, init: any) {
                this.url = url;
                this.body = init.body;
            }
            async json() {
                return typeof this.body === 'string' ? JSON.parse(this.body) : this.body;
            }
        },
        NextResponse: {
            json: (body: any, init?: any) => ({
                status: init?.status || 200,
                json: async () => body,
            }),
        },
    };
});

// Mock dependencies (keeping existing mocks)
const { NextRequest } = require('next/server'); // Re-import to use the mock class in tests

// Mock dependencies
jest.mock('@/config/firebaseAdminConfig', () => ({
    adminDb: {
        collection: jest.fn(),
    },
}));

jest.mock('@/api/clients/speechOptimization.client', () => ({
    optimizeTextForSpeech: jest.fn(),
}));

jest.mock('@/api/clients/tts.client', () => ({
    createAudioChunks: jest.fn(),
}));

describe('POST /api/sermons/[id]/audio/optimize', () => {
    const mockSermonId = 'sermon-123';
    const mockUserId = 'user-abc';

    // Mock Admin DB helpers
    const mockDoc = jest.fn();
    const mockGet = jest.fn();
    const mockUpdate = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();

        // Setup Firestore Mocks
        (adminDb.collection as jest.Mock).mockReturnValue({
            doc: mockDoc,
        });
        mockDoc.mockReturnValue({
            get: mockGet,
            update: mockUpdate,
            id: mockSermonId,
        });

        // Default Sermon Data
        mockGet.mockResolvedValue({
            exists: true,
            id: mockSermonId,
            data: () => ({
                title: 'Test Sermon',
                userId: mockUserId,
                verse: 'John 3:16',
                thoughts: [
                    { id: 't1', text: 'Thought 1', tags: ['introduction'] },
                    { id: 't2', text: 'Thought 2', tags: ['mainPart'] },
                ],
                audioChunks: []
            }),
        });

        // Default Optimization Mock
        (optimizeTextForSpeech as jest.Mock).mockResolvedValue({
            optimizedText: 'Optimized Result',
            optimizedLength: 16,
            chunks: ['Optimized Chunk'],
        });

        // Default TTS Chunk Creation Mock
        (createAudioChunks as jest.Mock).mockReturnValue([
            { text: 'Optimized Chunk', sectionId: 'introduction' }
        ]);
    });

    it('should process segments sequentially and pass context', async () => {
        // Arrange: Setup optimization to return distinct results
        (optimizeTextForSpeech as jest.Mock)
            .mockResolvedValueOnce({
                optimizedText: 'Ending of part 1. [End]',
                optimizedLength: 20,
                chunks: ['Chunk 1']
            })
            .mockResolvedValueOnce({
                optimizedText: 'Part 2 content.',
                optimizedLength: 15,
                chunks: ['Chunk 2']
            });

        const req = new NextRequest('http://localhost:3000/api/optimize', {
            method: 'POST',
            body: JSON.stringify({
                userId: mockUserId,
                sections: 'all'
            })
        });

        // Act
        const params = Promise.resolve({ id: mockSermonId });
        const res = await POST(req, { params });
        const json = await res.json();

        // Assert
        expect(res.status).toBe(200);
        expect(json.success).toBe(true);

        // Verify sequential calls
        expect(optimizeTextForSpeech).toHaveBeenCalledTimes(2); // Intro + Main (since 2 thoughts)

        // Check 1st Call (No context)
        expect(optimizeTextForSpeech).toHaveBeenNthCalledWith(
            1,
            expect.stringContaining('Thought 1'),
            expect.anything(),
            expect.objectContaining({
                previousContext: undefined
            })
        );

        // Check 2nd Call (With Context)
        expect(optimizeTextForSpeech).toHaveBeenNthCalledWith(
            2,
            expect.stringContaining('Thought 2'),
            expect.anything(),
            expect.objectContaining({
                previousContext: 'Ending of part 1. [End]' // This confirms the context passing!
            })
        );
    });

    it('should handle unauthorized access', async () => {
        mockGet.mockResolvedValue({
            exists: true,
            id: mockSermonId,
            data: () => ({ userId: 'other-user', title: 'Test' }),
        });

        const req = new NextRequest('http://localhost:3000/api/optimize', {
            method: 'POST',
            body: JSON.stringify({ userId: mockUserId, sections: 'all' })
        });

        const params = Promise.resolve({ id: mockSermonId });
        const res = await POST(req, { params });
        const json = await res.json();

        expect(res.status).toBe(403);
        expect(json.error).toBe('Forbidden');
    });

    it('should handle missing sermon', async () => {
        mockGet.mockResolvedValue({ exists: false });

        const req = new NextRequest('http://localhost:3000/api/optimize', {
            method: 'POST',
            body: JSON.stringify({ userId: mockUserId, sections: 'all' })
        });

        const params = Promise.resolve({ id: 'non-existent' });
        const res = await POST(req, { params });
        const json = await res.json();

        expect(res.status).toBe(404);
        expect(json.error).toBe('Sermon not found');
    });

    it('should return 401 if userId is missing', async () => {
        const req = new NextRequest('http://localhost:3000/api/optimize', {
            method: 'POST',
            body: JSON.stringify({ sections: 'all' })
        });

        const params = Promise.resolve({ id: mockSermonId });
        const res = await POST(req, { params });
        expect(res.status).toBe(401);
    });

    it('should handle optimization errors', async () => {
        (optimizeTextForSpeech as jest.Mock).mockRejectedValue(new Error('AI Failed'));

        const req = new NextRequest('http://localhost:3000/api/optimize', {
            method: 'POST',
            body: JSON.stringify({ userId: mockUserId, sections: 'all' })
        });

        const params = Promise.resolve({ id: mockSermonId });
        const res = await POST(req, { params });
        const json = await res.json();

        expect(res.status).toBe(500);
        expect(json.error).toBe('AI Failed');
    });

    it('should preserve existing chunks when processing a single section', async () => {
        const existingChunks = [{ index: 0, sectionId: 'conclusion', text: 'Old Conclusion' }];
        mockGet.mockResolvedValue({
            exists: true,
            id: mockSermonId,
            data: () => ({
                userId: mockUserId,
                audioChunks: existingChunks,
                thoughts: [{ id: 't1', text: 'New Intro', tags: ['introduction'] }]
            }),
        });

        const req = new NextRequest('http://localhost:3000/api/optimize', {
            method: 'POST',
            body: JSON.stringify({ userId: mockUserId, sections: 'introduction' })
        });

        const params = Promise.resolve({ id: mockSermonId });
        const res = await POST(req, { params });
        const json = await res.json();

        expect(json.success).toBe(true);
        // Should have 1 new chunk (intro) + 1 old chunk (conclusion) = 2 total
        expect(json.totalChunks).toBe(2);

        // Verify update call contains combined chunks
        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
            audioChunks: expect.arrayContaining([
                expect.objectContaining({ sectionId: 'introduction' }),
                expect.objectContaining({ sectionId: 'conclusion', text: 'Old Conclusion' })
            ])
        }));
    });

    it('should prioritize outline points if they exist', async () => {
        mockGet.mockResolvedValue({
            exists: true,
            id: mockSermonId,
            data: () => ({
                title: 'Test Sermon',
                userId: mockUserId,
                outline: {
                    mainPart: [{ id: 'p1', text: 'Point 1' }]
                },
                thoughts: [
                    { id: 't1', text: 'Thought attached to P1', outlinePointId: 'p1', tags: ['mainPart'] },
                    { id: 't2', text: 'Orphan thought', outlinePointId: null, tags: ['mainPart'] }
                ]
            }),
        });

        const req = new NextRequest('http://localhost:3000/api/optimize', {
            method: 'POST',
            body: JSON.stringify({ userId: mockUserId, sections: 'mainPart' })
        });

        const params = Promise.resolve({ id: mockSermonId });
        await POST(req, { params });

        expect(optimizeTextForSpeech).toHaveBeenCalledTimes(2);
    });

    it('should respect saveToDb: false', async () => {
        const req = new NextRequest('http://localhost:3000/api/optimize', {
            method: 'POST',
            body: JSON.stringify({ userId: mockUserId, sections: 'introduction', saveToDb: false })
        });

        const params = Promise.resolve({ id: mockSermonId });
        const res = await POST(req, { params });
        expect(res.status).toBe(200);
        expect(mockUpdate).not.toHaveBeenCalled();
    });
});
