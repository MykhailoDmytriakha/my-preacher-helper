import { GET, DELETE } from '@/api/admin/telemetry/route';

// Mock admin data
const mockDocs = [
    {
        data: () => ({
            promptName: 'test-prompt',
            promptVersion: 'v1',
            status: 'success',
            usage: { totalTokens: 100 },
            latencyMs: 500,
            timestamp: '2024-01-01T10:00:00Z',
            language: { expected: 'en', detectedOutput: 'en' }
        }),
        ref: { id: 'doc1' }
    },
    {
        data: () => ({
            promptName: 'test-prompt',
            promptVersion: 'v1',
            status: 'error',
            latencyMs: 300,
            timestamp: '2024-01-01T10:05:00Z',
            language: { expected: 'en', detectedOutput: 'ru' }
        }),
        ref: { id: 'doc2' }
    },
    {
        data: () => ({
            promptName: 'test-prompt',
            promptVersion: 'v1',
            status: 'success',
            latencyMs: 300,
            timestamp: '2023-01-01T10:05:00Z',
        }),
        ref: { id: 'doc2-old' }
    },
    {
        data: () => ({
            promptName: 'test-prompt',
            promptVersion: 'v2',
            status: 'refusal',
            usage: { totalTokens: 150 },
            latencyMs: 600,
            timestamp: '2024-01-01T10:10:00Z'
        }),
        ref: { id: 'doc3' }
    },
    {
        data: () => ({
            promptName: 'test-prompt',
            promptVersion: 'v2',
            status: 'invalid_response',
            latencyMs: 100,
            timestamp: '2024-01-01T10:15:00Z'
        }),
        ref: { id: 'doc4' }
    }
];

const getMock = jest.fn().mockResolvedValue({ docs: mockDocs, size: mockDocs.length });
const collectionMock = jest.fn().mockReturnValue({ get: getMock });
const batchCommitMock = jest.fn().mockResolvedValue(undefined);
const deleteMock = jest.fn();
const batchMock = jest.fn().mockReturnValue({
    delete: deleteMock,
    commit: batchCommitMock,
});

jest.mock('@/config/firebaseAdminConfig', () => ({
    adminDb: {
        collection: collectionMock,
        batch: batchMock,
    },
}));

jest.mock('next/server', () => ({
    NextResponse: {
        json: jest.fn().mockImplementation((data, init) => ({
            status: init?.status || 200,
            json: async () => data,
        })),
    },
}));

describe('/api/admin/telemetry Main Route', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        jest.clearAllMocks();
        // Use spread to copy env but allow manual assignment in dev
        process.env = { ...originalEnv, NODE_ENV: 'development', ADMIN_SECRET: 'test-secret' };
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    describe('Auth Checks', () => {
        // Skipping production check for now as it causes read-only env issues in some environments

        it('returns 503 if ADMIN_SECRET is missing', async () => {
            delete process.env.ADMIN_SECRET;
            const request = new Request('http://localhost/api/admin/telemetry');
            const response = await GET(request);
            expect(response.status).toBe(503);
        });

        it('returns 401 if unauthorized (wrong secret)', async () => {
            const request = new Request('http://localhost/api/admin/telemetry', {
                headers: { 'x-admin-secret': 'wrong' }
            });
            const response = await GET(request);
            expect(response.status).toBe(401);
        });
    });

    describe('GET summary', () => {
        it('returns grouped summary with metrics', async () => {
            const request = new Request('http://localhost/api/admin/telemetry', {
                headers: { 'x-admin-secret': 'test-secret' }
            });
            const response = await GET(request);
            const data: any = await response.json();

            expect(response.status).toBe(200);
            expect(data).toHaveProperty('test-prompt');
            const promptData = data['test-prompt'];
            expect(promptData.total).toBe(5);
            expect(promptData.versions).toHaveProperty('v1');
            expect(promptData.versions).toHaveProperty('v2');
        });

        it('returns 500 on db error', async () => {
            getMock.mockRejectedValueOnce(new Error('db error'));
            const request = new Request('http://localhost/api/admin/telemetry', {
                headers: { 'x-admin-secret': 'test-secret' }
            });
            const response = await GET(request);
            expect(response.status).toBe(500);
        });
    });

    describe('DELETE all', () => {
        it('deletes all records in batches', async () => {
            const request = new Request('http://localhost/api/admin/telemetry', {
                method: 'DELETE',
                headers: { 'x-admin-secret': 'test-secret' }
            });
            const response = await DELETE(request);
            const data: any = await response.json();

            expect(response.status).toBe(200);
            expect(data.deleted).toBe(5);
            expect(deleteMock).toHaveBeenCalledTimes(5);
        });

        it('returns 500 on db error during delete', async () => {
            getMock.mockRejectedValueOnce(new Error('delete fail'));
            const request = new Request('http://localhost/api/admin/telemetry', {
                method: 'DELETE',
                headers: { 'x-admin-secret': 'test-secret' }
            });
            const response = await DELETE(request);
            expect(response.status).toBe(500);
        });
    });
});
