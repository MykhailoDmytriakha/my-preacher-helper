import { sortItemsWithAI } from '@/services/sortAI.service';
import { toast } from 'sonner';
import fetchMock from 'jest-fetch-mock';

// Mock the fetch API
fetchMock.enableMocks();

// Mock the toast notifications
jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

// Hard code the API URL for testing instead of using environment variable
const API_URL = 'http://localhost:3000';

describe('sortItemsWithAI', () => {
  beforeEach(() => {
    fetchMock.resetMocks();
    jest.clearAllMocks();
  });

  const mockItems = [
    { id: 'item1', content: 'First item content', customTagNames: [] },
    { id: 'item2', content: 'Second item content', customTagNames: [] },
    { id: 'item3', content: 'Third item content', customTagNames: [] },
  ];

  const mockOutlinePoints = [
    { id: 'outline1', text: 'Introduction point' },
    { id: 'outline2', text: 'Main point' },
  ];

  test('successfully sorts items when API returns valid response', async () => {
    // Arrange
    const mockSermonId = 'sermon123';
    const mockColumnId = 'introduction';

    const sortedItemsResponse = {
      sortedItems: [
        { id: 'item3', content: 'Third item content', customTagNames: [] },
        { id: 'item1', content: 'First item content', customTagNames: [] },
        { id: 'item2', content: 'Second item content', customTagNames: [] },
      ],
    };

    fetchMock.mockResponseOnce(JSON.stringify(sortedItemsResponse), { status: 200 });

    // Act
    const result = await sortItemsWithAI(
      mockColumnId,
      mockItems,
      mockSermonId,
      mockOutlinePoints
    );

    // Assert
    expect(fetchMock).toHaveBeenCalledTimes(1);
    
    // Get the request data from the fetch mock call
    const mockCall = fetchMock.mock.calls[0];
    expect(mockCall).toBeTruthy();
    
    const requestOptions = mockCall[1] as RequestInit;
    expect(requestOptions).toBeTruthy();
    expect(requestOptions.body).toBeTruthy();
    
    const requestBody = JSON.parse(requestOptions.body as string);
    expect(requestBody).toEqual({
      columnId: mockColumnId,
      items: mockItems,
      sermonId: mockSermonId,
      outlinePoints: mockOutlinePoints,
    });
    
    expect(result).toEqual(sortedItemsResponse.sortedItems);
  });

  test('handles API error responses appropriately', async () => {
    // Arrange
    const columnId = 'main';
    const sermonId = 'sermon123';

    fetchMock.mockResponseOnce(JSON.stringify({ error: 'Failed to sort items' }), { status: 500 });

    // Act & Assert
    await expect(sortItemsWithAI(columnId, mockItems, sermonId, mockOutlinePoints))
      .rejects.toThrow('Sorting failed with status 500');
    
    expect(toast.error).toHaveBeenCalledWith('Error sorting items with AI. Please try again.');
  });

  test('handles network errors gracefully', async () => {
    // Arrange
    const columnId = 'conclusion';
    const sermonId = 'sermon123';

    fetchMock.mockRejectOnce(new Error('Network error'));

    // Act & Assert
    await expect(sortItemsWithAI(columnId, mockItems, sermonId, mockOutlinePoints))
      .rejects.toThrow('Network error');
    
    expect(toast.error).toHaveBeenCalledWith('Error sorting items with AI. Please try again.');
  });

  test('returns all items in response', async () => {
    // Arrange
    const columnId = 'introduction';
    const sermonId = 'sermon123';
    const sortedItems = [
      { id: 'item2', content: 'Second item content', customTagNames: [] },
      { id: 'item3', content: 'Third item content', customTagNames: [] },
      { id: 'item1', content: 'First item content', customTagNames: [] },
    ];

    fetchMock.mockResponseOnce(JSON.stringify({ sortedItems }));

    // Act
    const result = await sortItemsWithAI(columnId, mockItems, sermonId, mockOutlinePoints);

    // Assert
    expect(result.length).toBe(mockItems.length);
    mockItems.forEach(item => {
      expect(result.some(sortedItem => sortedItem.id === item.id)).toBe(true);
    });
  });

  test('handles empty items array gracefully', async () => {
    // Arrange
    const columnId = 'introduction';
    const sermonId = 'sermon123';
    const emptyItems: any[] = [];

    fetchMock.mockResponseOnce(JSON.stringify({ sortedItems: [] }));

    // Act
    const result = await sortItemsWithAI(columnId, emptyItems, sermonId, mockOutlinePoints);

    // Assert
    expect(result).toEqual([]);
  });
}); 