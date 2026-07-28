import { GET, DELETE } from '@/api/admin/telemetry/route';

// Mock admin data
const mockDocs = [
    {
        data: () => ({
            promptName: 'test-prompt',
            promptVersion: 'v1',
            jsonStructureStatus: 'success',
            status: 'success',
            qualityReview: { quality: 'good', keepAsExample: true },
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
            jsonStructureStatus: 'error',
            status: 'error',
            qualityReview: { quality: 'bad', keepAsExample: false },
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
            jsonStructureStatus: 'refusal',
            status: 'refusal',
            qualityReview: { quality: 'needs_review', keepAsExample: false },
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
            jsonStructureStatus: 'invalid_response',
            status: 'invalid_response',
            qualityReview: { quality: 'unreviewed', keepAsExample: false },
            latencyMs: 100,
            timestamp: '2024-01-01T10:15:00Z'
        }),
        ref: { id: 'doc4' }
    }
];

const getMock = jest.fn().mockResolvedValue({ docs: mockDocs, size: mockDocs.length });
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

describe('/api/admin/telemetry Main Route', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        jest.clearAllMocks();
        // Use spread to copy env but allow manual assignment in dev
        process.env = { ...originalEnv, NODE_ENV: 'development', ADMIN_EMAIL: 'owner@example.com' };
        mockVerifyIdToken.mockResolvedValue({
            uid: 'admin-uid',
            email: 'owner@example.com',
            email_verified: true,
        });
        collectionMock.mockReturnValue({ get: getMock });
        batchMock.mockReturnValue({
            delete: deleteMock,
            commit: batchCommitMock,
        });
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    describe('Auth Checks', () => {
        // Skipping production check for now as it causes read-only env issues in some environments

        it('returns 401 if the bearer token is missing', async () => {
            const request = new Request('http://localhost/api/admin/telemetry');
            const response = await GET(request);
            expect(response.status).toBe(401);
            expect(mockVerifyIdToken).not.toHaveBeenCalled();
            expect(collectionMock).not.toHaveBeenCalled();
        });

        it('returns 401 if the bearer token is invalid', async () => {
            mockVerifyIdToken.mockRejectedValueOnce(new Error('invalid token'));
            const request = new Request('http://localhost/api/admin/telemetry', {
                headers: { authorization: 'Bearer invalid-token' }
            });
            const response = await GET(request);
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
            const request = new Request('http://localhost/api/admin/telemetry', {
                headers: { authorization: 'Bearer user-token' }
            });
            const response = await GET(request);
            expect(response.status).toBe(403);
            expect(collectionMock).not.toHaveBeenCalled();
        });

        it('rejects the legacy x-admin-secret header by itself', async () => {
            const request = new Request('http://localhost/api/admin/telemetry', {
                headers: { 'x-admin-secret': 'test-secret' }
            });
            const response = await GET(request);
            expect(response.status).toBe(401);
            expect(mockVerifyIdToken).not.toHaveBeenCalled();
            expect(collectionMock).not.toHaveBeenCalled();
        });
    });

    describe('GET summary', () => {
        it('returns grouped summary with metrics', async () => {
            const request = new Request('http://localhost/api/admin/telemetry', {
                headers: adminHeaders
            });
            const response = await GET(request);
            const data: any = await response.json();

            expect(response.status).toBe(200);
            expect(data).toHaveProperty('test-prompt');
            const promptData = data['test-prompt'];
            expect(promptData.total).toBe(5);
            expect(promptData.versions).toHaveProperty('v1');
            expect(promptData.versions).toHaveProperty('v2');
            expect(promptData.versions.v1.jsonStructureSuccessRate).toBe(0.67);
            expect(promptData.versions.v1.goodCount).toBe(1);
            expect(promptData.versions.v1.badCount).toBe(1);
            expect(promptData.versions.v1.unreviewedCount).toBe(1);
            expect(promptData.versions.v1.exampleCount).toBe(1);
            expect(promptData.versions.v1.goodRate).toBe(0.5);
        });

        it('returns 500 on db error', async () => {
            getMock.mockRejectedValueOnce(new Error('db error'));
            const request = new Request('http://localhost/api/admin/telemetry', {
                headers: adminHeaders
            });
            const response = await GET(request);
            expect(response.status).toBe(500);
        });
    });

    describe('DELETE all', () => {
        it('deletes all records in batches', async () => {
            const request = new Request('http://localhost/api/admin/telemetry', {
                method: 'DELETE',
                headers: adminHeaders
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
                headers: adminHeaders
            });
            const response = await DELETE(request);
            expect(response.status).toBe(500);
        });
    });

    describe('Prompt names and the turnstile', () => {
        const summaryFor = async (docs: Array<Record<string, unknown>>) => {
            getMock.mockResolvedValueOnce({
                docs: docs.map((d, i) => ({ data: () => d, ref: { id: `d${i}` } })),
                size: docs.length,
            });
            const request = new Request('http://localhost/api/admin/telemetry', { headers: adminHeaders });
            return (await (await GET(request)).json()) as any;
        };

        it('folds records written under the old name onto the current key', async () => {
            const data = await summaryFor([
                // Записано до переименования.
                { promptName: 'plan_point_content', promptVersion: 'v13', status: 'success', latencyMs: 1000, timestamp: '2026-07-01T00:00:00Z' },
                // Записано после.
                { promptName: 'sermon.conspect.point', promptVersion: 'v13', status: 'success', latencyMs: 3000, timestamp: '2026-07-27T00:00:00Z' },
            ]);

            // Один промпт — одна строка, иначе история разъедется надвое.
            expect(Object.keys(data)).toEqual(['sermon.conspect.point']);
            expect(data['sermon.conspect.point'].total).toBe(2);
            expect(data['sermon.conspect.point'].display).toBe('Проповедь · Конспект · текст одного пункта');
            expect(data['sermon.conspect.point'].area).toBe('Проповедь');
            expect(data['sermon.conspect.point'].stage).toBe('Конспект');
        });

        it('counts unfinished calls apart and keeps them out of the success denominator', async () => {
            const data = await summaryFor([
                { promptName: 'sermon.conspect.point', promptVersion: 'v13', status: 'success', latencyMs: 1000, timestamp: '2026-07-27T00:00:00Z', phase: 'finished' },
                { promptName: 'sermon.conspect.point', promptVersion: 'v13', status: 'success', latencyMs: 1000, timestamp: '2026-07-27T00:01:00Z', phase: 'finished' },
                // Отмечен на входе и не вернулся: убит потолком, упал процесс, оборвалась связь.
                { promptName: 'sermon.conspect.point', promptVersion: 'v13', timestamp: '2026-07-27T00:02:00Z', phase: 'started' },
            ]);

            const version = data['sermon.conspect.point'].versions.v13;
            expect(version.count).toBe(3);
            expect(version.unfinishedCount).toBe(1);
            expect(version.unfinishedRate).toBe(0.33);
            // Успех считается от ВЕРНУВШИХСЯ: 2 из 2, а не 2 из 3 — иначе доехавшие
            // выглядели бы хуже, чем они есть, и обе цифры врали бы разом.
            expect(version.successRate).toBe(1);
            expect(version.avgLatencyMs).toBe(1000);
        });

        it('shows an unknown name as it is instead of hiding it', async () => {
            const data = await summaryFor([
                { promptName: 'some_future_prompt', promptVersion: 'v1', status: 'success', latencyMs: 100, timestamp: '2026-07-27T00:00:00Z' },
            ]);

            expect(data['some_future_prompt'].display).toBe('some_future_prompt');
            expect(data['some_future_prompt'].area).toBeNull();
        });
    });
});
