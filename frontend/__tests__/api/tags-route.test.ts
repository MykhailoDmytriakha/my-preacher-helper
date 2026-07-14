/**
 * API Tests for /api/tags route
 */

import * as clients from '@/api/clients/firestore.client';
import * as route from '@/api/tags/route';

// Mock firebase admin and clients
jest.mock('@/config/firebaseAdminConfig', () => ({
  adminDb: {
    collection: jest.fn(),
  },
  initAdmin: jest.fn(),
}));

// Mock next/server to avoid pulling actual Request class in node env
jest.mock('next/server', () => ({
  NextResponse: { json: (data: any, init?: any) => ({ status: init?.status ?? 200, json: async () => data }) }
}));

jest.mock('@/api/clients/firestore.client', () => ({
  deleteTag: jest.fn(),
}));

jest.mock('@/api/auth/requireAuthenticatedUid.server', () => ({
  getRequiredAuthenticatedUid: jest.fn().mockResolvedValue('u1'),
}));

const mockClients = clients as jest.Mocked<typeof clients>;

describe('Tags API Route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('DELETE performs cascade and returns affectedThoughts', async () => {
    mockClients.deleteTag.mockResolvedValue({ affectedThoughts: 3 });
    const req = { url: 'https://example.com/api/tags?userId=u1&tagName=Custom' } as any;
    const res = await route.DELETE(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.affectedThoughts).toBe(3);
  });
});
