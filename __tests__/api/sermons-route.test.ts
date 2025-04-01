import { GET, POST } from '@/api/sermons/route';
import { NextResponse } from 'next/server';
import { adminDb } from '@/config/firebaseAdminConfig'; // Keep using alias here, mock intercepts it

// Mock MUST be placed after imports but before describe/tests
jest.mock('@/config/firebaseAdminConfig', () => ({
  adminDb: {
    collection: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ docs: [] }), // Default mock for GET
      add: jest.fn().mockResolvedValue({ id: 'mock-doc-id' }), // Default mock for POST
    }),
  },
}));

// Reset mocks before each test
beforeEach(() => {
  // Restore the original implementation or reset mocks if necessary
  // Ensure the mocked functions are reset
  (adminDb.collection as jest.Mock).mockClear();
  const collectionMock = adminDb.collection();
  (collectionMock.where as jest.Mock).mockClear();
  (collectionMock.get as jest.Mock).mockClear();
  (collectionMock.add as jest.Mock).mockClear();

  // Reset to default mock implementation
  (adminDb.collection as jest.Mock).mockReturnValue({
    where: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({ docs: [] }),
    add: jest.fn().mockResolvedValue({ id: 'mock-doc-id' }),
  });
});

describe('Sermons API Route', () => {
  describe('GET /api/sermons', () => {
    it('should return 401 if userId is missing', async () => {
      const request = new Request('http://localhost/api/sermons');
      const response = await GET(request);
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe('User not authenticated');
    });

    it('should return sermons for a valid userId', async () => {
      const mockDocs = [
        { id: 'sermon1', data: () => ({ title: 'Sermon 1', userId: 'user1' }) },
        { id: 'sermon2', data: () => ({ title: 'Sermon 2', userId: 'user1' }) },
      ];
      // Configure the mock specifically for this test
      const getMock = jest.fn().mockResolvedValue({ docs: mockDocs });
      const whereMock = jest.fn().mockReturnThis();
      (adminDb.collection as jest.Mock).mockReturnValue({
        where: whereMock,
        get: getMock,
      });

      const request = new Request('http://localhost/api/sermons?userId=user1');
      const response = await GET(request);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveLength(2);
      expect(body[0].title).toBe('Sermon 1');
      expect(adminDb.collection).toHaveBeenCalledWith('sermons');
      expect(whereMock).toHaveBeenCalledWith('userId', '==', 'user1');
      expect(getMock).toHaveBeenCalled();
    });

    it('should return 500 if Firestore query fails', async () => {
       // Configure the mock specifically for this test
       const getMock = jest.fn().mockRejectedValue(new Error('Firestore error'));
       const whereMock = jest.fn().mockReturnThis();
       (adminDb.collection as jest.Mock).mockReturnValue({
         where: whereMock,
         get: getMock,
       });

      const request = new Request('http://localhost/api/sermons?userId=user1');
      const response = await GET(request);

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toBe('Failed to fetch sermons');
    });
  });

  describe('POST /api/sermons', () => {
    it('should return 400 if required sermon data is missing', async () => {
      const incompleteSermon = { userId: 'user1', title: 'Test' }; // Missing verse and date
      const request = new Request('http://localhost/api/sermons', {
        method: 'POST',
        body: JSON.stringify(incompleteSermon),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('sermon data is missing');
    });

    it('should create a sermon and return it with an ID', async () => {
      const newSermonData = {
        userId: 'user1',
        title: 'New Sermon',
        verse: 'John 3:16',
        date: '2023-01-01',
        thoughts: [{ text: 'Thought 1' }],
      };

       // Configure the mock specifically for this test
       const addMock = jest.fn().mockResolvedValue({ id: 'new-sermon-id' });
       (adminDb.collection as jest.Mock).mockReturnValue({ add: addMock });

      const request = new Request('http://localhost/api/sermons', {
        method: 'POST',
        body: JSON.stringify(newSermonData),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
      const body = await response.json();

      expect(addMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'New Sermon' }));
      expect(body.message).toBe('Sermon created successfully');
      expect(body.sermon).toBeDefined();
      expect(body.sermon.id).toBe('new-sermon-id');
      expect(body.sermon.title).toBe('New Sermon');
    });

    it('should return 500 if Firestore add operation fails', async () => {
      const newSermonData = {
        userId: 'user1',
        title: 'Error Sermon',
        verse: 'Verse',
        date: '2023-01-01',
      };
       // Configure the mock specifically for this test
       const addMock = jest.fn().mockRejectedValue(new Error('Firestore add error'));
       (adminDb.collection as jest.Mock).mockReturnValue({ add: addMock });


      const request = new Request('http://localhost/api/sermons', {
        method: 'POST',
        body: JSON.stringify(newSermonData),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toBe('Failed to create sermon');
    });
  });
}); 