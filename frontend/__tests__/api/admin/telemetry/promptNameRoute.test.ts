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

const batchCommitMock = jest.fn().mockResolvedValue(undefined);
const deleteMock = jest.fn();

jest.mock('@/config/firebaseAdminConfig', () => ({
    adminAuth: {
        verifyIdToken: jest.fn(),
    },
    adminDb: {
        collection: jest.fn(),
        batch: jest.fn(),
    },
    FieldValue: {
        serverTimestamp: jest.fn(() => 'mocked-server-timestamp'),
    },
}));

const { adminAuth, adminDb } = jest.requireMock('@/config/firebaseAdminConfig') as {
    adminAuth: { verifyIdToken: jest.Mock };
    adminDb: { collection: jest.Mock; batch: jest.Mock };
};
const mockVerifyIdToken = adminAuth.verifyIdToken;
const collectionMock = adminDb.collection;
const batchMock = adminDb.batch;
const adminHeaders = { authorization: 'Bearer admin-token' };

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
        process.env = { ...originalEnv, NODE_ENV: 'development', ADMIN_EMAIL: 'owner@example.com' };
        mockVerifyIdToken.mockResolvedValue({
            uid: 'admin-uid',
            email: 'owner@example.com',
            email_verified: true,
        });
        collectionMock.mockReturnValue({
            where: whereMock,
            orderBy: orderByMock,
            limit: limitMock,
            doc: docMock,
            get: getMock,
        });
        batchMock.mockReturnValue({
            delete: deleteMock,
            commit: batchCommitMock,
        });
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    describe('Auth Checks', () => {
        const params = Promise.resolve({ promptName: 'test-prompt' });

        it('returns 401 if the bearer token is missing', async () => {
            const response = await GET(
                new Request('http://localhost/api/admin/telemetry/test-prompt'),
                { params }
            );

            expect(response.status).toBe(401);
            expect(mockVerifyIdToken).not.toHaveBeenCalled();
            expect(collectionMock).not.toHaveBeenCalled();
        });

        it('returns 401 if the bearer token is invalid', async () => {
            mockVerifyIdToken.mockRejectedValueOnce(new Error('invalid token'));
            const response = await GET(
                new Request('http://localhost/api/admin/telemetry/test-prompt', {
                    headers: { authorization: 'Bearer invalid-token' },
                }),
                { params }
            );

            expect(response.status).toBe(401);
            expect(mockVerifyIdToken).toHaveBeenCalledWith('invalid-token', true);
            expect(collectionMock).not.toHaveBeenCalled();
        });

        it('returns 403 for an authenticated non-admin email', async () => {
            mockVerifyIdToken.mockResolvedValueOnce({
                uid: 'user-uid',
                email: 'user@example.com',
                email_verified: true,
            });
            const response = await GET(
                new Request('http://localhost/api/admin/telemetry/test-prompt', {
                    headers: { authorization: 'Bearer user-token' },
                }),
                { params }
            );

            expect(response.status).toBe(403);
            expect(collectionMock).not.toHaveBeenCalled();
        });

        it('rejects the legacy x-admin-secret header by itself', async () => {
            const response = await GET(
                new Request('http://localhost/api/admin/telemetry/test-prompt', {
                    headers: { 'x-admin-secret': 'test-secret' },
                }),
                { params }
            );

            expect(response.status).toBe(401);
            expect(mockVerifyIdToken).not.toHaveBeenCalled();
            expect(collectionMock).not.toHaveBeenCalled();
        });
    });

    describe('GET specific prompt records', () => {
        it('returns filtered records for specific prompt', async () => {
            const request = new Request('http://localhost/api/admin/telemetry/test-prompt', {
                headers: adminHeaders
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
                headers: adminHeaders
            });
            const params = Promise.resolve({ promptName: 'test-prompt' });
            await GET(request, { params });

            expect(whereMock).toHaveBeenCalledWith('promptVersion', '==', 'v1');
        });

        it('handles decoding of promptName', async () => {
            const request = new Request('http://localhost/api/admin/telemetry/encoded%20name', {
                headers: adminHeaders
            });
            const params = Promise.resolve({ promptName: 'encoded%20name' });
            await GET(request, { params });

            expect(whereMock).toHaveBeenCalledWith('promptName', '==', 'encoded name');
        });

        it('filters reviewed examples by quality', async () => {
            const request = new Request('http://localhost/api/admin/telemetry/test-prompt?quality=good&examples=true', {
                headers: adminHeaders
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
                headers: adminHeaders
            });
            const params = Promise.resolve({ promptName: 'test-prompt' });
            const response = await GET(request, { params });

            expect(response.status).toBe(400);
        });

        it('returns 500 on error', async () => {
            getMock.mockRejectedValueOnce(new Error('fail'));
            const request = new Request('http://localhost/api/admin/telemetry/test', {
                headers: adminHeaders
            });
            const params = Promise.resolve({ promptName: 'test' });
            const response = await GET(request, { params });
            expect(response.status).toBe(500);
        });

        it('returns 403 in production mode', async () => {
            (process.env as any).NODE_ENV = 'production';
            const request = new Request('http://localhost/api/admin/telemetry/test', {
                headers: adminHeaders
            });
            const params = Promise.resolve({ promptName: 'test' });
            const response = await GET(request, { params });
            expect(response.status).toBe(403);
            const data: any = await response.json();
            expect(data.error).toBe('Not available in production');
        });

        it('returns 503 if ADMIN_EMAIL is not configured', async () => {
            delete process.env.ADMIN_EMAIL;
            const request = new Request('http://localhost/api/admin/telemetry/test', {
                headers: adminHeaders
            });
            const params = Promise.resolve({ promptName: 'test' });
            const response = await GET(request, { params });
            expect(response.status).toBe(503);
            const data: any = await response.json();
            expect(data.error).toBe('Admin access is not configured');
        });
    });

    describe('PATCH review labels', () => {
        it('marks a telemetry record as a bad example for prompt iteration', async () => {
            const request = new Request('http://localhost/api/admin/telemetry/test-prompt', {
                method: 'PATCH',
                headers: adminHeaders,
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
                headers: adminHeaders,
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
                headers: adminHeaders,
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
                headers: adminHeaders
            });
            const params = Promise.resolve({ promptName: 'test-prompt' });
            const response = await DELETE(request, { params });
            const data: any = await response.json();

            expect(response.status).toBe(200);
            expect(data.deleted).toBe(2);
            expect(deleteMock).toHaveBeenCalledTimes(2);
        });

        it('returns 401 for an invalid bearer token in DELETE', async () => {
            mockVerifyIdToken.mockRejectedValueOnce(new Error('invalid token'));
            const request = new Request('http://localhost/api/admin/telemetry/test', {
                method: 'DELETE',
                headers: { authorization: 'Bearer invalid-token' }
            });
            const params = Promise.resolve({ promptName: 'test' });
            const response = await DELETE(request, { params });
            expect(response.status).toBe(401);
        });

        it('returns 500 on delete error', async () => {
            getMock.mockRejectedValueOnce(new Error('delete fail'));
            const request = new Request('http://localhost/api/admin/telemetry/test', {
                method: 'DELETE',
                headers: adminHeaders
            });
            const params = Promise.resolve({ promptName: 'test' });
            const response = await DELETE(request, { params });
            expect(response.status).toBe(500);
        });

        it('applies version filter in DELETE from query', async () => {
            const request = new Request('http://localhost/api/admin/telemetry/test-prompt?version=v2', {
                method: 'DELETE',
                headers: adminHeaders
            });
            const params = Promise.resolve({ promptName: 'test-prompt' });
            await DELETE(request, { params });

            expect(whereMock).toHaveBeenCalledWith('promptVersion', '==', 'v2');
        });
    });
});
