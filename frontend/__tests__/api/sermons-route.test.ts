// We'll use a simpler approach without importing from Next.js
// This avoids the 'Request is not defined' error

import { adminDb } from '@/config/firebaseAdminConfig';

// Mock type for Request
interface MockRequest {
  url?: string;
  json: () => Promise<any>;
}

// Mock the adminDb to avoid actual Firestore calls
jest.mock('@/config/firebaseAdminConfig', () => ({
  adminDb: {
    collection: jest.fn(),
  },
}));

// Mock the NextResponse
jest.mock('next/server', () => ({
  NextResponse: {
    json: jest.fn().mockImplementation((data, options = {}) => {
      return {
        status: options.status || 200,
        json: async () => data,
      };
    }),
  },
}));

// Mock the series repository to verify it is called when seriesId is set
const mockAddSermonToSeries = jest.fn().mockResolvedValue(undefined);
jest.mock('@/api/repositories/series.repository', () => ({
  seriesRepository: {
    addSermonToSeries: (...args: unknown[]) => mockAddSermonToSeries(...args),
  },
}));

// Import the handlers module directly to mock
import * as sermonsRouteModule from 'app/api/sermons/route';


describe('Sermons API Route', () => {
  let mockRequest: MockRequest;
  let mockCollection: jest.Mock;
  let mockAdd: jest.Mock;
  let mockDoc: jest.Mock;
  let mockDelete: jest.Mock;
  let mockDocRef: any;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Set up mock docRef for POST tests
    mockDelete = jest.fn().mockResolvedValue(undefined);
    mockDocRef = {
      id: 'newSermonId123',
      delete: mockDelete
    };

    // Create mock Firestore chain
    mockAdd = jest.fn().mockResolvedValue(mockDocRef);
    // doc(id) — for the client-supplied-id (idempotent) create path. By default
    // the doc does not exist, so the route writes via .set() and keeps the id.
    mockDoc = jest.fn().mockImplementation((id: string) => ({
      id,
      get: jest.fn().mockResolvedValue({ exists: false }),
      set: jest.fn().mockResolvedValue(undefined),
      delete: mockDelete,
    }));
    mockCollection = jest.fn().mockReturnValue({
      add: mockAdd,
      doc: mockDoc,
    });

    // Apply the mocks
    const mockedAdminDb = adminDb as unknown as { collection: jest.Mock };
    mockedAdminDb.collection.mockImplementation(mockCollection);

    // Set up basic request object
    mockRequest = {
      json: jest.fn(),
    };
  });

  describe('POST handler', () => {
    test('should create a sermon successfully', async () => {
      // Arrange
      const sermonData = {
        userId: 'user123',
        title: 'New Sermon',
        verse: 'Matthew 5:1-12',
        date: '2023-02-01',
        thoughts: []
      };
      mockRequest.json = jest.fn().mockResolvedValueOnce(sermonData);

      // Act
      const response = await sermonsRouteModule.POST(mockRequest as unknown as Request);
      const responseData = await response.json();

      // Assert
      expect(mockCollection).toHaveBeenCalledWith('sermons');
      expect(mockAdd).toHaveBeenCalledWith({
        userId: 'user123',
        title: 'New Sermon',
        verse: 'Matthew 5:1-12',
        date: '2023-02-01',
        thoughts: []
      });
      expect(response.status).toBe(200);
      expect(responseData).toHaveProperty('message', 'Sermon created successfully');
      expect(responseData).toHaveProperty('sermon');
      expect(responseData.sermon.id).toBe('newSermonId123');
      expect(responseData.sermon.title).toBe('New Sermon');
    });

    test('should return 400 when required fields are missing', async () => {
      // Test scenarios for each required field
      const testCases = [
        { ...{ title: 'Test', verse: 'John 3:16', date: '2023-01-01' }, missing: 'userId' },
        { ...{ userId: 'user123', verse: 'John 3:16', date: '2023-01-01' }, missing: 'title' },
        { ...{ userId: 'user123', title: 'Test', date: '2023-01-01' }, missing: 'verse' },
        { ...{ userId: 'user123', title: 'Test', verse: 'John 3:16' }, missing: 'date' }
      ];

      for (const testCase of testCases) {
        // Arrange
        mockRequest.json = jest.fn().mockResolvedValueOnce(testCase);

        // Act
        const response = await sermonsRouteModule.POST(mockRequest as unknown as Request);
        const responseData = await response.json();

        // Assert
        expect(response.status).toBe(400);
        expect(responseData).toHaveProperty('error');
        expect(responseData.error).toBe('User not authenticated or sermon data is missing');
        expect(mockAdd).not.toHaveBeenCalled();
      }
    });

    test('should handle Firestore errors when creating sermon', async () => {
      // Arrange
      const sermonData = {
        userId: 'user123',
        title: 'New Sermon',
        verse: 'Matthew 5:1-12',
        date: '2023-02-01',
        thoughts: []
      };
      mockRequest.json = jest.fn().mockResolvedValueOnce(sermonData);
      mockAdd.mockRejectedValueOnce(new Error('Firestore error'));

      // Act
      const response = await sermonsRouteModule.POST(mockRequest as unknown as Request);
      const responseData = await response.json();

      // Assert
      expect(response.status).toBe(500);
      expect(responseData).toHaveProperty('error');
      expect(responseData.error).toBe('Failed to create sermon');
    });

    test('should handle request parsing errors', async () => {
      // Arrange
      mockRequest.json = jest.fn().mockRejectedValueOnce(new Error('Invalid JSON'));

      // Act
      const response = await sermonsRouteModule.POST(mockRequest as unknown as Request);
      const responseData = await response.json();

      // Assert
      expect(response.status).toBe(500);
      expect(responseData).toHaveProperty('error');
      expect(responseData.error).toBe('Failed to create sermon');
    });

    test('should correctly create sermon with optional thoughts field', async () => {
      // Arrange
      const sermonData = {
        userId: 'user123',
        title: 'New Sermon',
        verse: 'Matthew 5:1-12',
        date: '2023-02-01'
        // thoughts field is intentionally omitted
      };
      mockRequest.json = jest.fn().mockResolvedValueOnce(sermonData);

      // Act
      const response = await sermonsRouteModule.POST(mockRequest as unknown as Request);
      const responseData = await response.json();

      // Assert
      expect(mockAdd).toHaveBeenCalledWith({
        userId: 'user123',
        title: 'New Sermon',
        verse: 'Matthew 5:1-12',
        date: '2023-02-01',
        thoughts: [] // Should default to empty array
      });
      expect(responseData.sermon.id).toBe('newSermonId123');
    });

    test('should preserve existing fields from sermon input', async () => {
      // Arrange
      const sermonData = {
        userId: 'user123',
        title: 'New Sermon',
        verse: 'Matthew 5:1-12',
        date: '2023-02-01',
        thoughts: [],
        outline: { introduction: [], main: [], conclusion: [] },
        customField: 'test value'
      };
      mockRequest.json = jest.fn().mockResolvedValueOnce(sermonData);

      // Act
      const response = await sermonsRouteModule.POST(mockRequest as unknown as Request);
      const responseData = await response.json();

      // Assert
      expect(response.status).toBe(200);
      expect(responseData.sermon).toHaveProperty('customField', 'test value');
      expect(responseData.sermon).toHaveProperty('outline');
      expect(responseData.sermon.id).toBe('newSermonId123');
    });

    test('uses a client-supplied id via the idempotent create path', async () => {
      // A client-supplied id is now honored (offline buffer / navigation): the
      // route writes via doc(id).set() and returns that id, instead of allocating
      // a new one with .add().
      const sermonData = {
        id: 'client-id-xyz',
        userId: 'user123',
        title: 'New Sermon',
        verse: 'Matthew 5:1-12',
        date: '2023-02-01',
        thoughts: []
      };
      mockRequest.json = jest.fn().mockResolvedValueOnce(sermonData);

      // Act
      const response = await sermonsRouteModule.POST(mockRequest as unknown as Request);
      const responseData = await response.json();

      // Assert
      expect(mockDoc).toHaveBeenCalledWith('client-id-xyz');
      expect(mockAdd).not.toHaveBeenCalled(); // client-id path uses doc().set(), not add()
      expect(responseData.sermon.id).toBe('client-id-xyz');
    });

    // Playlist migration: the create route NEVER links a sermon into a series.
    // Membership lives in series.items and is written exclusively by the client
    // sweep — so addSermonToSeries is never called from POST /api/sermons, even
    // when a (now-ignored) seriesId is present in the request body.
    test('does NOT link the sermon into a series even when seriesId is provided', async () => {
      const sermonData = {
        userId: 'user123',
        title: 'New Sermon In A Series',
        verse: 'John 1:1',
        date: '2023-02-01',
        thoughts: [],
        seriesId: 'series-abc',
      };
      mockRequest.json = jest.fn().mockResolvedValueOnce(sermonData);

      const response = await sermonsRouteModule.POST(mockRequest as unknown as Request);
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.sermon.id).toBe('newSermonId123');
      expect(mockAddSermonToSeries).not.toHaveBeenCalled();
    });

    test('does NOT call addSermonToSeries when no seriesId is provided', async () => {
      const sermonData = {
        userId: 'user123',
        title: 'Standalone Sermon',
        verse: 'John 1:1',
        date: '2023-02-01',
        thoughts: [],
      };
      mockRequest.json = jest.fn().mockResolvedValueOnce(sermonData);

      await sermonsRouteModule.POST(mockRequest as unknown as Request);

      expect(mockAddSermonToSeries).not.toHaveBeenCalled();
    });
  });
});
