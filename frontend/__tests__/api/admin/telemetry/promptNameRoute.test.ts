import { GET, PATCH, DELETE } from '@/api/admin/telemetry/[promptName]/route';

// Mock data
const mockRecords = [
    {
        eventId: 'event-1',
        promptName: 'test-prompt',
        promptVersion: 'v1',
        timestamp: '2024-01-01T10:00:00Z',
        jsonStructureStatus: 'success',
        qualityReview: { quality: 'good', keepAsExample: true },
    },
    {
        eventId: 'event-2',
        promptName: 'test-prompt',
        promptVersion: 'v1',
        timestamp: '2024-01-01T10:05:00Z',
        jsonStructureStatus: 'success',
        qualityReview: { quality: 'bad', keepAsExample: false },
    },
];

const limitMock = jest.fn().mockReturnThis();
const orderByMock = jest.fn().mockReturnThis();
const whereMock = jest.fn().mockReturnThis();
const getMock = jest.fn().mockResolvedValue({
    docs: mockRecords.map(r => ({ id: r.eventId, data: () => r, ref: { id: r.eventId } })),
    size: mockRecords.length
});
const docGetMock = jest.fn().mockResolvedValue({
    exists: true,
    data: () => mockRecords[0],
});
const docUpdateMock = jest.fn().mockResolvedValue(undefined);
const docMock = jest.fn().mockReturnValue({
    get: docGetMock,
    update: docUpdateMock,
});

const collectionMock = jest.fn().mockReturnValue({
    where: whereMock,
    orderBy: orderByMock,
    limit: limitMock,
    doc: docMock,
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
    FieldValue: {
        serverTimestamp: jest.fn(() => 'mocked-server-timestamp'),
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
            expect(data.records[0].documentId).toBe('event-2');
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

        it('filters reviewed examples by quality', async () => {
            const request = new Request('http://localhost/api/admin/telemetry/test-prompt?quality=good&examples=true', {
                headers: { 'x-admin-secret': 'test-secret' }
            });
            const params = Promise.resolve({ promptName: 'test-prompt' });
            const response = await GET(request, { params });
            const data: any = await response.json();

            expect(response.status).toBe(200);
            expect(data.quality).toBe('good');
            expect(data.examplesOnly).toBe(true);
            expect(data.records).toHaveLength(1);
            expect(data.records[0].eventId).toBe('event-1');
        });

        it('rejects invalid quality filters', async () => {
            const request = new Request('http://localhost/api/admin/telemetry/test-prompt?quality=excellent', {
                headers: { 'x-admin-secret': 'test-secret' }
            });
            const params = Promise.resolve({ promptName: 'test-prompt' });
            const response = await GET(request, { params });

            expect(response.status).toBe(400);
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

    describe('PATCH review labels', () => {
        it('marks a telemetry record as a bad example for prompt iteration', async () => {
            const request = new Request('http://localhost/api/admin/telemetry/test-prompt', {
                method: 'PATCH',
                headers: { 'x-admin-secret': 'test-secret' },
                body: JSON.stringify({
                    eventId: 'event-1',
                    quality: 'bad',
                    reviewedBy: 'codex',
                    issueTypes: ['scripture_reference_format'],
                    notes: 'Reference stayed as dictated prose.',
                    expectedOutput: 'Втор. 10:11',
                }),
            });
            const params = Promise.resolve({ promptName: 'test-prompt' });

            const response = await PATCH(request, { params });
            const data: any = await response.json();

            expect(response.status).toBe(200);
            expect(docMock).toHaveBeenCalledWith('event-1');
            expect(docUpdateMock).toHaveBeenCalledWith(expect.objectContaining({
                qualityReview: expect.objectContaining({
                    quality: 'bad',
                    reviewedBy: 'codex',
                    issueTypes: ['scripture_reference_format'],
                    notes: 'Reference stayed as dictated prose.',
                    keepAsExample: false,
                    resolutionStatus: 'open',
                    expectedOutput: expect.objectContaining({
                        value: 'Втор. 10:11',
                    }),
                }),
                updatedAt: 'mocked-server-timestamp',
            }));
            expect(data.qualityReview.quality).toBe('bad');
        });

        it('returns 400 for invalid review payloads', async () => {
            const request = new Request('http://localhost/api/admin/telemetry/test-prompt', {
                method: 'PATCH',
                headers: { 'x-admin-secret': 'test-secret' },
                body: JSON.stringify({
                    eventId: 'event-1',
                    quality: 'excellent',
                }),
            });
            const params = Promise.resolve({ promptName: 'test-prompt' });

            const response = await PATCH(request, { params });
            const data: any = await response.json();

            expect(response.status).toBe(400);
            expect(data.error).toBe('Invalid review payload');
        });

        it('returns 409 when event belongs to another prompt', async () => {
            docGetMock.mockResolvedValueOnce({
                exists: true,
                data: () => ({ ...mockRecords[0], promptName: 'other-prompt' }),
            });
            const request = new Request('http://localhost/api/admin/telemetry/test-prompt', {
                method: 'PATCH',
                headers: { 'x-admin-secret': 'test-secret' },
                body: JSON.stringify({
                    eventId: 'event-1',
                    quality: 'good',
                }),
            });
            const params = Promise.resolve({ promptName: 'test-prompt' });

            const response = await PATCH(request, { params });

            expect(response.status).toBe(409);
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
