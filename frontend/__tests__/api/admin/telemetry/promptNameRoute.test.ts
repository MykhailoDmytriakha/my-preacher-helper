import { GET, DELETE } from '@/api/admin/telemetry/[promptName]/route';

// Mock data
const mockRecords = [
    { promptName: 'test-prompt', promptVersion: 'v1', timestamp: '2024-01-01T10:00:00Z' },
    { promptName: 'test-prompt', promptVersion: 'v1', timestamp: '2024-01-01T10:05:00Z' },
];

const limitMock = jest.fn().mockReturnThis();
const orderByMock = jest.fn().mockReturnThis();
const whereMock = jest.fn().mockReturnThis();
const getMock = jest.fn().mockResolvedValue({
    docs: mockRecords.map(r => ({ data: () => r, ref: { id: 'doc' } })),
    size: mockRecords.length
});

const collectionMock = jest.fn().mockReturnValue({
    where: whereMock,
    orderBy: orderByMock,
    limit: limitMock,
    get: getMock,
});

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

describe('/api/admin/telemetry/[promptName] Route', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...originalEnv, NODE_ENV: 'development', ADMIN_SECRET: 'test-secret' };
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    describe('GET specific prompt records', () => {
        it('returns filtered records for specific prompt', async () => {
            const request = new Request('http://localhost/api/admin/telemetry/test-prompt', {
                headers: { 'x-admin-secret': 'test-secret' }
            });
            const params = Promise.resolve({ promptName: 'test-prompt' });
            const response = await GET(request, { params });
            const data: any = await response.json();

            expect(response.status).toBe(200);
            expect(data.promptName).toBe('test-prompt');
            expect(data.records).toHaveLength(2);
            expect(whereMock).toHaveBeenCalledWith('promptName', '==', 'test-prompt');
        });

        it('applies version filter from query', async () => {
            const request = new Request('http://localhost/api/admin/telemetry/test-prompt?limit=10&version=v1', {
                headers: { 'x-admin-secret': 'test-secret' }
            });
            const params = Promise.resolve({ promptName: 'test-prompt' });
            await GET(request, { params });

            expect(whereMock).toHaveBeenCalledWith('promptVersion', '==', 'v1');
        });

        it('handles decoding of promptName', async () => {
            const request = new Request('http://localhost/api/admin/telemetry/encoded%20name', {
                headers: { 'x-admin-secret': 'test-secret' }
            });
            const params = Promise.resolve({ promptName: 'encoded%20name' });
            await GET(request, { params });

            expect(whereMock).toHaveBeenCalledWith('promptName', '==', 'encoded name');
        });

        it('returns 500 on error', async () => {
            getMock.mockRejectedValueOnce(new Error('fail'));
            const request = new Request('http://localhost/api/admin/telemetry/test', {
                headers: { 'x-admin-secret': 'test-secret' }
            });
            const params = Promise.resolve({ promptName: 'test' });
            const response = await GET(request, { params });
            expect(response.status).toBe(500);
        });

        it('returns 403 in production mode', async () => {
            (process.env as any).NODE_ENV = 'production';
            const request = new Request('http://localhost/api/admin/telemetry/test', {
                headers: { 'x-admin-secret': 'test-secret' }
            });
            const params = Promise.resolve({ promptName: 'test' });
            const response = await GET(request, { params });
            expect(response.status).toBe(403);
            const data: any = await response.json();
            expect(data.error).toBe('Not available in production');
        });

        it('returns 503 if ADMIN_SECRET is not configured', async () => {
            delete process.env.ADMIN_SECRET;
            const request = new Request('http://localhost/api/admin/telemetry/test', {
                headers: { 'x-admin-secret': 'test-secret' }
            });
            const params = Promise.resolve({ promptName: 'test' });
            const response = await GET(request, { params });
            expect(response.status).toBe(503);
            const data: any = await response.json();
            expect(data.error).toBe('ADMIN_SECRET is not configured');
        });
    });

    describe('DELETE specific prompt records', () => {
        it('deletes records for specific prompt', async () => {
            const request = new Request('http://localhost/api/admin/telemetry/test-prompt', {
                method: 'DELETE',
                headers: { 'x-admin-secret': 'test-secret' }
            });
            const params = Promise.resolve({ promptName: 'test-prompt' });
            const response = await DELETE(request, { params });
            const data: any = await response.json();

            expect(response.status).toBe(200);
            expect(data.deleted).toBe(2);
            expect(deleteMock).toHaveBeenCalledTimes(2);
        });

        it('returns 401 if unauthorized in DELETE', async () => {
            const request = new Request('http://localhost/api/admin/telemetry/test', {
                method: 'DELETE',
                headers: { 'x-admin-secret': 'wrong' }
            });
            const params = Promise.resolve({ promptName: 'test' });
            const response = await DELETE(request, { params });
            expect(response.status).toBe(401);
        });

        it('returns 500 on delete error', async () => {
            getMock.mockRejectedValueOnce(new Error('delete fail'));
            const request = new Request('http://localhost/api/admin/telemetry/test', {
                method: 'DELETE',
                headers: { 'x-admin-secret': 'test-secret' }
            });
            const params = Promise.resolve({ promptName: 'test' });
            const response = await DELETE(request, { params });
            expect(response.status).toBe(500);
        });

        it('applies version filter in DELETE from query', async () => {
            const request = new Request('http://localhost/api/admin/telemetry/test-prompt?version=v2', {
                method: 'DELETE',
                headers: { 'x-admin-secret': 'test-secret' }
            });
            const params = Promise.resolve({ promptName: 'test-prompt' });
            await DELETE(request, { params });

            expect(whereMock).toHaveBeenCalledWith('promptVersion', '==', 'v2');
        });
    });
});
