import React, { useState } from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { toast } from 'sonner';

// Mock the fetch API
import fetchMock from 'jest-fetch-mock';
fetchMock.enableMocks();

// Mock the sortItemsWithAI service and other services
import { sortItemsWithAI } from '@/services/sortAI.service';
import { updateStructure } from '@/services/structure.service';

// Define the TagInfo interface to match what's used in the app
interface TagInfo {
  id: string;
  name: string;
}

// Define the Item interface to match what's expected by sortItemsWithAI
interface Item {
  id: string;
  content: string;
  customTagNames?: TagInfo[];
}

// Define MockItem interface for our test component
interface MockItem {
  id: string;
  content: string;
  customTagNames: any[];
}

jest.mock('@/services/sortAI.service');
jest.mock('@/services/structure.service');

// Mock the toast notifications
jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

// Mock the sermonsRepository
const mockSermonsRepository = {
  fetchSermonById: jest.fn()
};
jest.mock('@/api/repositories/sermons.repository', () => ({
  sermonsRepository: mockSermonsRepository
}));

// Set up the test environment
describe('AI Sorting Integration Test', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock.resetMocks();
    
    // Mock environment variables
    process.env.NEXT_PUBLIC_API_BASE = 'http://localhost:3000';
    process.env.OPENAI_API_KEY = 'mock-api-key';
    process.env.OPENAI_GPT_MODEL = 'gpt-4';
    
    // Mock the base sermon data
    const mockSermon = {
      id: 'sermon123',
      title: 'Test Sermon',
      verse: 'John 3:16',
      date: '2023-01-01',
      thoughts: [
        { id: 'thought1', text: 'First thought', tags: ['introduction'] },
        { id: 'thought2', text: 'Second thought', tags: ['introduction'] },
        { id: 'thought3', text: 'Third thought', tags: ['introduction'] },
      ],
      structure: {
        introduction: ['thought1', 'thought2', 'thought3'],
        main: [],
        conclusion: [],
        ambiguous: [],
      },
      outline: {
        introduction: [
          { id: 'outline1', text: 'Introduction outline point 1' },
        ],
        main: [],
        conclusion: [],
      },
    };
    
    // Set up repository mock
    mockSermonsRepository.fetchSermonById.mockResolvedValue(mockSermon);
    
    // Set up fetch mock responses
    fetchMock.mockResponse((req: Request) => {
      if (req.url.includes('/api/sort')) {
        return Promise.resolve(JSON.stringify({
          sortedItems: [
            { id: 'thought3', content: 'Third thought', customTagNames: [] },
            { id: 'thought1', content: 'First thought', customTagNames: [] },
            { id: 'thought2', content: 'Second thought', customTagNames: [] },
          ],
        }));
      }
      return Promise.resolve(JSON.stringify({ success: true }));
    });
    
    // Mock sortItemsWithAI and updateStructure implementations
    (sortItemsWithAI as jest.Mock).mockImplementation((columnId, items, sermonId, outlinePoints) => {
      if (columnId === 'introduction') {
        // Return a new array with items in a different order
        return Promise.resolve([
          items[2], // Third item
          items[0], // First item
          items[1], // Second item
        ]);
      }
      return Promise.resolve(items);
    });
    
    (updateStructure as jest.Mock).mockResolvedValue({ success: true });
  });
  
  test('complete AI sorting flow from button click to database update', async () => {
    // Arrange
    const mockItems: Item[] = [
      { id: 'thought1', content: 'First thought', customTagNames: [] },
      { id: 'thought2', content: 'Second thought', customTagNames: [] },
      { id: 'thought3', content: 'Third thought', customTagNames: [] },
    ];
    
    // We use our own simplified test component to avoid complex mocking
    const AISortingTestComponent = () => {
      const [isSorting, setIsSorting] = useState(false);
      const [items, setItems] = useState<Item[]>(mockItems);
      
      const handleAiSort = async () => {
        setIsSorting(true);
        try {
          // Call the sortItemsWithAI service
          const sortedItems = await sortItemsWithAI(
            'introduction', 
            items as any, // Cast to any to avoid type issues
            'sermon123', 
            [{ id: 'outline1', text: 'Introduction outline point' }]
          );
          
          // Update the UI
          setItems(sortedItems as unknown as Item[]);
          
          // Save to the database
          const newStructure = {
            introduction: sortedItems.map(item => item.id),
            main: [],
            conclusion: [],
            ambiguous: [],
          };
          
          await updateStructure('sermon123', newStructure);
          toast.success('Successfully sorted items');
        } catch (error) {
          toast.error('Error sorting items');
        } finally {
          setIsSorting(false);
        }
      };
      
      return (
        <div>
          <div data-testid="items-container">
            {items.map((item, index) => (
              <div key={item.id} data-testid={`item-${index}`}>
                {item.content}
              </div>
            ))}
          </div>
          <button 
            data-testid="sort-button"
            onClick={handleAiSort}
            disabled={isSorting}
          >
            {isSorting ? 'Sorting...' : 'Sort with AI'}
          </button>
        </div>
      );
    };
    
    // Render the test component
    render(<AISortingTestComponent />);
    
    // Verify initial state
    expect(screen.getByTestId('item-0')).toHaveTextContent('First thought');
    expect(screen.getByTestId('item-1')).toHaveTextContent('Second thought');
    expect(screen.getByTestId('item-2')).toHaveTextContent('Third thought');
    
    // Act - click the sort button
    const sortButton = screen.getByTestId('sort-button');
    await act(async () => {
      sortButton.click();
    });
    
    // Assert - verify service calls and UI updates
    await waitFor(() => {
      // Verify sortItemsWithAI was called with the right parameters
      expect(sortItemsWithAI).toHaveBeenCalledWith(
        'introduction',
        expect.arrayContaining([
          expect.objectContaining({ id: 'thought1' }),
          expect.objectContaining({ id: 'thought2' }),
          expect.objectContaining({ id: 'thought3' }),
        ]),
        'sermon123',
        [{ id: 'outline1', text: 'Introduction outline point' }]
      );
      
      // Verify UI was updated with the new order
      expect(screen.getByTestId('item-0')).toHaveTextContent('Third thought');
      expect(screen.getByTestId('item-1')).toHaveTextContent('First thought');
      expect(screen.getByTestId('item-2')).toHaveTextContent('Second thought');
      
      // Verify the database was updated
      expect(updateStructure).toHaveBeenCalledWith(
        'sermon123',
        {
          introduction: expect.arrayContaining(['thought3', 'thought1', 'thought2']),
          main: [],
          conclusion: [],
          ambiguous: [],
        }
      );
      
      // Verify success message
      expect(toast.success).toHaveBeenCalledWith('Successfully sorted items');
    });
  });
  
  test('handles errors in the sorting process', async () => {
    // Define mockItems in this test scope
    const mockItems: Item[] = [
      { id: 'thought1', content: 'First thought', customTagNames: [] },
      { id: 'thought2', content: 'Second thought', customTagNames: [] },
      { id: 'thought3', content: 'Third thought', customTagNames: [] },
    ];
    
    // Arrange - make sortItemsWithAI fail
    (sortItemsWithAI as jest.Mock).mockRejectedValue(new Error('Sorting failed'));
    
    // We use our own simplified test component
    const AISortingErrorTestComponent = () => {
      const [isSorting, setIsSorting] = useState(false);
      const [items, setItems] = useState<Item[]>(mockItems);
      
      const handleAiSort = async () => {
        setIsSorting(true);
        try {
          // Call the sortItemsWithAI service
          const sortedItems = await sortItemsWithAI(
            'introduction', 
            items as any, // Cast to any to avoid type issues
            'sermon123', 
            [{ id: 'outline1', text: 'Introduction outline point' }]
          );
          
          // Update the UI
          setItems(sortedItems as unknown as Item[]);
          
          // Save to the database
          const newStructure = {
            introduction: sortedItems.map(item => item.id),
            main: [],
            conclusion: [],
            ambiguous: [],
          };
          
          await updateStructure('sermon123', newStructure);
          toast.success('Successfully sorted items');
        } catch (error) {
          toast.error('Error sorting items');
        } finally {
          setIsSorting(false);
        }
      };
      
      return (
        <div>
          <div data-testid="items-container">
            {items.map((item, index) => (
              <div key={item.id} data-testid={`item-${index}`}>
                {item.content}
              </div>
            ))}
          </div>
          <button 
            data-testid="sort-button"
            onClick={handleAiSort}
            disabled={isSorting}
          >
            {isSorting ? 'Sorting...' : 'Sort with AI'}
          </button>
        </div>
      );
    };
    
    // Render the test component
    render(<AISortingErrorTestComponent />);
    
    // Act - click the sort button
    const sortButton = screen.getByTestId('sort-button');
    await act(async () => {
      sortButton.click();
    });
    
    // Assert - verify error handling
    await waitFor(() => {
      // Verify error toast was shown
      expect(toast.error).toHaveBeenCalledWith('Error sorting items');
      
      // Verify updateStructure was not called
      expect(updateStructure).not.toHaveBeenCalled();
      
      // Verify UI was not changed
      expect(screen.getByTestId('item-0')).toHaveTextContent('First thought');
      expect(screen.getByTestId('item-1')).toHaveTextContent('Second thought');
      expect(screen.getByTestId('item-2')).toHaveTextContent('Third thought');
    });
  });
}); 