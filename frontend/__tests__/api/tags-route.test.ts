/**
 * API Tests for /api/tags route
 */

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
  getRequiredTags: jest.fn(),
  getCustomTags: jest.fn(),
  saveTag: jest.fn(),
  deleteTag: jest.fn(),
  updateTagInDb: jest.fn(),
}));

describe('Tags API Route', () => {
  const route = require('@/api/tags/route');
  const clients = require('@/api/clients/firestore.client');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('GET returns required and custom tags', async () => {
    clients.getRequiredTags.mockResolvedValue([{ id: 'intro', name: 'Intro', color: '#111', required: true }]);
    clients.getCustomTags.mockResolvedValue([{ id: 'c1', name: 'Custom', color: '#222', required: false }]);

    const req = { url: 'https://example.com/api/tags?userId=u1' } as unknown as Request;
    const res = await route.GET(req);
    const data = await res.json();

    expect(data.requiredTags).toHaveLength(1);
    expect(data.customTags).toHaveLength(1);
  });

  it('POST rejects reserved names with 400', async () => {
    clients.saveTag.mockRejectedValueOnce(new Error('RESERVED_NAME'));
    const body = { name: 'Introduction', userId: 'u1', color: '#fff', required: false };
    // Mock Next.js Request with minimal shape used in handler
    const req = { json: async () => body } as any;
    const res = await route.POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.message).toMatch(/Reserved/);
  });

  it('PUT rejects required tag update with 400', async () => {
    const body = { name: 'Intro', userId: 'u1', color: '#fff', required: true };
    const req = { json: async () => body } as unknown as Request;
    const res = await route.PUT(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.message).toMatch(/Required tags cannot be updated/);
  });

  it('DELETE performs cascade and returns affectedThoughts', async () => {
    clients.deleteTag.mockResolvedValue({ affectedThoughts: 3 });
    const req = { url: 'https://example.com/api/tags?userId=u1&tagName=Custom' } as any;
    const res = await route.DELETE(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.affectedThoughts).toBe(3);
  });
});


