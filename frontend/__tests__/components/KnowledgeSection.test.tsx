import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Sermon, Insights, VerseWithRelevance, DirectionSuggestion } from '@/models/models';
import KnowledgeSection from '@/components/sermon/KnowledgeSection';
import * as insightsService from '@/services/insights.service';

// Extend global Window interface to include our test flag
declare global {
  var __CONSOLE_OVERRIDDEN_BY_TEST__: boolean;
}

// Mock the insights service
jest.mock('@/services/insights.service', () => ({
  generateInsights: jest.fn(),
  generateTopics: jest.fn(),
  generateRelatedVerses: jest.fn(),
  generatePossibleDirections: jest.fn(),
}));

// Mock the translations
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: any) => {
      const translations: { [key: string]: string } = {
        'knowledge.title': 'Knowledge and Insights',
        'knowledge.showMore': 'Show more',
        'knowledge.showLess': 'Show less',
        'knowledge.coveredTopics': 'Covered Topics',
        'knowledge.relatedVerses': 'Related Verses',
        'knowledge.possibleDirections': 'Possible Directions',
        'knowledge.showAll': 'Show all',
        'knowledge.hideAll': 'Hide all',
        'knowledge.refresh': 'Refresh',
        'knowledge.generate': 'Generate Insights',
        'knowledge.generating': 'Generating...',
        'knowledge.noInsights': 'No insights have been generated yet.',
        'knowledge.clickToExpand': 'Click to expand insights',
        'knowledge.insightsGenerated': 'Insights generated!',
        'knowledge.insightsThreshold': options?.count > 1 
          ? `You need ${options?.count} more thoughts to unlock insights. Currently: ${options?.thoughtsCount || 0} of 20 required`
          : `You need ${options?.count} more thought to unlock insights. Currently: ${options?.thoughtsCount || 0} of 20 required`,
      };
      return translations[key] || key;
    },
    i18n: {
      language: 'en',
    },
  }),
}));

// Mock setTimeout to immediately execute callbacks
jest.useFakeTimers();

describe('KnowledgeSection Component', () => {
  const mockUpdateSermon = jest.fn();
  
  // Sample data
  const mockSermonWithoutInsights: Sermon = {
    id: 'sermon1',
    title: 'Test Sermon',
    verse: 'John 3:16',
    date: '2023-01-01',
    thoughts: [],
    userId: 'user1',
  };
  
  const mockInsights: Insights = {
    topics: ['Faith', 'Love', 'Redemption'],
    relatedVerses: [
      { reference: 'Romans 5:8', relevance: 'Shows God\'s love for us' },
      { reference: 'Ephesians 2:8-9', relevance: 'Salvation through faith' }
    ],
    possibleDirections: [
      { area: 'God\'s Love', suggestion: 'Focus on God\'s love' },
      { area: 'Grace', suggestion: 'Explain the concept of grace' }
    ]
  };
  
  const mockSermonWithInsights: Sermon = {
    ...mockSermonWithoutInsights,
    insights: mockInsights
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup default mock implementations
    (insightsService.generateInsights as jest.Mock).mockResolvedValue(mockInsights);
    (insightsService.generateTopics as jest.Mock).mockResolvedValue({
      ...mockInsights,
      topics: ['New Faith', 'New Love', 'New Redemption']
    });
    
    (insightsService.generateRelatedVerses as jest.Mock).mockResolvedValue({
      ...mockInsights,
      relatedVerses: [
        { reference: 'Matthew 5:16', relevance: 'Let your light shine before others' },
        { reference: 'Philippians 4:13', relevance: 'I can do all things through Christ' }
      ]
    });
    
    (insightsService.generatePossibleDirections as jest.Mock).mockResolvedValue({
      ...mockInsights,
      possibleDirections: [
        { area: 'New Direction', suggestion: 'New direction 1' },
        { area: 'Another Direction', suggestion: 'New direction 2' }
      ]
    });
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  it('renders without insights and shows generate button', async () => {
    // Modify sermon to have exactly 20 thoughts so insights can be generated
    const sermonWithEnoughThoughts = {
      ...mockSermonWithoutInsights,
      thoughts: Array(20).fill({ id: 'thought-id', text: 'Thought text', tags: [] })
    };
    
    render(<KnowledgeSection sermon={sermonWithEnoughThoughts} updateSermon={mockUpdateSermon} />);
    
    // Wait for loading state to finish - properly wrapped in act()
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    
    expect(screen.getByText('Knowledge and Insights')).toBeInTheDocument();
    expect(screen.getByText('No insights have been generated yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate Insights' })).toBeInTheDocument();
  });

  it('renders with insights in collapsed state', async () => {
    render(<KnowledgeSection sermon={mockSermonWithInsights} updateSermon={mockUpdateSermon} />);
    
    // Wait for loading state to finish - properly wrapped in act()
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    
    expect(screen.getByText('Knowledge and Insights')).toBeInTheDocument();
    // No longer check for the hint text since it's been removed from the component
    // expect(screen.getByText('Click to expand insights')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument();
  });

  it('expands and collapses when the button is clicked', async () => {
    render(<KnowledgeSection sermon={mockSermonWithInsights} updateSermon={mockUpdateSermon} />);
    
    // Wait for loading state to finish - properly wrapped in act()
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    
    // Verify the initial state has collapsed UI
    expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument();
    
    // Click to expand - wrap in act()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    });
    
    // Should show sections when expanded
    expect(screen.getByText('Covered Topics')).toBeInTheDocument();
    expect(screen.getByText('Related Verses')).toBeInTheDocument();
    expect(screen.getByText('Possible Directions')).toBeInTheDocument();
    
    // Button should now say "Show less"
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument();
    
    // Click to collapse - wrap in act()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
    });
    
    // Button should now say "Show more" again
    expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument();
  });

  it('generates all insights when button is clicked', async () => {
    // Mock the generateInsights function to delay its resolution
    (insightsService.generateInsights as jest.Mock).mockImplementation(() => {
      return new Promise(resolve => {
        setTimeout(() => resolve(mockInsights), 100);
      });
    });

    // Create a sermon with enough thoughts to generate insights
    const sermonWithEnoughThoughts = {
      ...mockSermonWithoutInsights,
      thoughts: Array(20).fill({ id: 'thought-id', text: 'Thought text', tags: [] })
    };

    render(<KnowledgeSection sermon={sermonWithEnoughThoughts} updateSermon={mockUpdateSermon} />);
    
    // Wait for loading state to finish - properly wrapped in act()
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    
    // Clear previous mocks
    jest.clearAllMocks();
    
    // Click generate button - wrap in act()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Generate Insights' }));
      
      // Fast-forward timers to complete the API call
      jest.advanceTimersByTime(100);
    });
    
    // Wait for API call to resolve - wrap in act()
    await act(async () => {
      // Run all pending promises
      await Promise.resolve();
      // Fast-forward timers for success notification
      jest.runAllTimers();
    });
    
    // Verify updateSermon was called with the generated insights
    expect(mockUpdateSermon).toHaveBeenCalled();
  });

  it('shows and hides topics when toggle is clicked', async () => {
    render(<KnowledgeSection sermon={mockSermonWithInsights} updateSermon={mockUpdateSermon} />);
    
    // Wait for loading state to finish - properly wrapped in act()
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    
    // Expand the section - wrap in act()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    });
    
    // Topics should be visible by default
    expect(screen.getByText('Faith')).toBeInTheDocument();
    expect(screen.getByText('Love')).toBeInTheDocument();
    expect(screen.getByText('Redemption')).toBeInTheDocument();
    
    // Get all Hide all buttons and click the first one (for topics) - wrap in act()
    await act(async () => {
      const hideButtons = screen.getAllByText('Hide all');
      fireEvent.click(hideButtons[0]);
    });
    
    // Topics should be hidden
    expect(screen.queryByText('Faith')).not.toBeInTheDocument();
    
    // Get all Show all buttons and click the first one - wrap in act()
    await act(async () => {
      const showButtons = screen.getAllByText('Show all');
      fireEvent.click(showButtons[0]);
    });
    
    // Topics should be visible again
    expect(screen.getByText('Faith')).toBeInTheDocument();
  });

  it('regenerates topics when the refresh button is clicked', async () => {
    // Mock the generateTopics to delay its resolution
    (insightsService.generateTopics as jest.Mock).mockImplementation(() => {
      return new Promise(resolve => {
        setTimeout(() => {
          resolve({
            ...mockInsights,
            topics: ['New Faith', 'New Love', 'New Redemption']
          });
        }, 100);
      });
    });

    render(<KnowledgeSection sermon={mockSermonWithInsights} updateSermon={mockUpdateSermon} />);
    
    // Wait for loading state to finish - properly wrapped in act()
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    
    // Expand the section - wrap in act()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    });
    
    // Clear previous mocks
    jest.clearAllMocks();
    
    // Find and click the regenerate topics button
    await act(async () => {
      const refreshButtons = screen.getAllByTitle('Refresh');
      fireEvent.click(refreshButtons[0]); // First refresh button is for topics
      
      // Fast-forward timers to complete the API call
      jest.advanceTimersByTime(100);
    });
    
    // Wait for API call to resolve - wrap in act()
    await act(async () => {
      await Promise.resolve();
      jest.runAllTimers();
    });
    
    expect(insightsService.generateTopics).toHaveBeenCalledWith('sermon1');
    expect(mockUpdateSermon).toHaveBeenCalledWith(expect.objectContaining({
      id: 'sermon1',
      insights: expect.objectContaining({
        topics: ['New Faith', 'New Love', 'New Redemption']
      })
    }));
  });

  it('regenerates verses when the refresh button is clicked', async () => {
    // Mock the generateRelatedVerses to delay its resolution
    (insightsService.generateRelatedVerses as jest.Mock).mockImplementation(() => {
      return new Promise(resolve => {
        setTimeout(() => {
          resolve({
            ...mockInsights,
            relatedVerses: [
              { reference: 'Matthew 5:16', relevance: 'Let your light shine before others' },
              { reference: 'Philippians 4:13', relevance: 'I can do all things through Christ' }
            ]
          });
        }, 100);
      });
    });

    render(<KnowledgeSection sermon={mockSermonWithInsights} updateSermon={mockUpdateSermon} />);
    
    // Wait for loading state to finish - properly wrapped in act()
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    
    // Expand the section - wrap in act()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    });
    
    // Clear previous mocks
    jest.clearAllMocks();
    
    // Find and click the regenerate verses button
    await act(async () => {
      const refreshButtons = screen.getAllByTitle('Refresh');
      fireEvent.click(refreshButtons[1]); // Second refresh button is for verses
      
      // Fast-forward timers to complete the API call
      jest.advanceTimersByTime(100);
    });
    
    // Wait for API call to resolve - wrap in act()
    await act(async () => {
      await Promise.resolve();
      jest.runAllTimers();
    });
    
    expect(insightsService.generateRelatedVerses).toHaveBeenCalledWith('sermon1');
    expect(mockUpdateSermon).toHaveBeenCalledWith(expect.objectContaining({
      id: 'sermon1',
      insights: expect.objectContaining({
        relatedVerses: expect.arrayContaining([
          expect.objectContaining({ reference: expect.any(String), relevance: expect.any(String) })
        ])
      })
    }));
  });

  it('regenerates directions when the refresh button is clicked', async () => {
    // Mock the generatePossibleDirections to delay its resolution
    (insightsService.generatePossibleDirections as jest.Mock).mockImplementation(() => {
      return new Promise(resolve => {
        setTimeout(() => {
          resolve({
            ...mockInsights,
            possibleDirections: [
              { area: 'New Direction', suggestion: 'New direction 1' },
              { area: 'Another Direction', suggestion: 'New direction 2' }
            ]
          });
        }, 100);
      });
    });

    render(<KnowledgeSection sermon={mockSermonWithInsights} updateSermon={mockUpdateSermon} />);
    
    // Wait for loading state to finish - properly wrapped in act()
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    
    // Expand the section - wrap in act()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    });
    
    // Clear previous mocks
    jest.clearAllMocks();
    
    // Find and click the regenerate directions button
    await act(async () => {
      const refreshButtons = screen.getAllByTitle('Refresh');
      fireEvent.click(refreshButtons[2]); // Third refresh button is for directions
      
      // Fast-forward timers to complete the API call
      jest.advanceTimersByTime(100);
    });
    
    // Wait for API call to resolve - wrap in act()
    await act(async () => {
      await Promise.resolve();
      jest.runAllTimers();
    });
    
    expect(insightsService.generatePossibleDirections).toHaveBeenCalledWith('sermon1');
    expect(mockUpdateSermon).toHaveBeenCalledWith(expect.objectContaining({
      id: 'sermon1',
      insights: expect.objectContaining({
        possibleDirections: expect.arrayContaining([
          expect.objectContaining({ area: expect.any(String), suggestion: expect.any(String) })
        ])
      })
    }));
  });

  it('handles API errors when generating all insights', async () => {
    // Mock API errors for all three services
    (insightsService.generateTopics as jest.Mock).mockRejectedValue(new Error('API Error - Topics'));
    (insightsService.generateRelatedVerses as jest.Mock).mockRejectedValue(new Error('API Error - Verses'));
    (insightsService.generatePossibleDirections as jest.Mock).mockRejectedValue(new Error('API Error - Directions'));
    
    // Create a mock for console.error
    const mockErrorFn = jest.fn();
    
    // Save original console.error
    const originalConsoleError = console.error;
    
    // Set our global flag to true to tell the jest.setup.js we're overriding console methods
    global.__CONSOLE_OVERRIDDEN_BY_TEST__ = true;
    
    // Replace console.error with our mock
    console.error = mockErrorFn;
    
    try {
      // Render with sermon that has enough thoughts
      const { getByText } = render(
        <KnowledgeSection
          sermon={{
            id: 'test-sermon',
            title: 'Test Sermon',
            verse: 'John 3:16',
            date: '2023-01-01',
            thoughts: Array(20).fill({ id: 'thought-id', text: 'Thought text', tags: [] }),
            userId: 'user1',
          }}
          updateSermon={mockUpdateSermon}
        />
      );
      
      // Wait for initial loading
      await act(async () => {
        jest.advanceTimersByTime(600);
      });
      
      // Click generate button
      fireEvent.click(getByText('Generate Insights'));
      
      // Wait for API error to be processed
      await waitFor(() => {
        expect(mockErrorFn).toHaveBeenCalled();
      }, { timeout: 3000 });
    } finally {
      // Restore original console.error
      console.error = originalConsoleError;
      
      // Reset our flag
      global.__CONSOLE_OVERRIDDEN_BY_TEST__ = false;
    }
  });

  it('handles API errors when regenerating topics', async () => {
    // Mock API error
    (insightsService.generateTopics as jest.Mock).mockRejectedValue(new Error('API Error'));
    
    // Spy on console.error
    const originalConsoleError = console.error;
    const mockConsoleError = jest.fn();
    
    // Set the global flag to indicate we're overriding console methods
    global.__CONSOLE_OVERRIDDEN_BY_TEST__ = true;
    console.error = mockConsoleError;
    
    try {
      render(<KnowledgeSection sermon={mockSermonWithInsights} updateSermon={mockUpdateSermon} />);
      
      // Wait for loading state to finish - properly wrapped in act()
      await act(async () => {
        jest.advanceTimersByTime(600);
      });
      
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument();
      });
      
      // Expand the section - wrap in act()
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
      });
      
      // Find and click the regenerate topics button
      const refreshButtons = screen.getAllByTitle('Refresh');
      fireEvent.click(refreshButtons[0]);
      
      // Wait for error to be logged
      await waitFor(() => {
        expect(console.error).toHaveBeenCalled();
      });
    } finally {
      // Restore original console.error
      console.error = originalConsoleError;
    }
  });

  it('handles API errors when regenerating verses', async () => {
    // Mock API error
    (insightsService.generateRelatedVerses as jest.Mock).mockRejectedValue(new Error('API Error'));
    
    // Spy on console.error
    const originalConsoleError = console.error;
    const mockConsoleError = jest.fn();
    
    // Set the global flag to indicate we're overriding console methods
    global.__CONSOLE_OVERRIDDEN_BY_TEST__ = true;
    console.error = mockConsoleError;
    
    try {
      render(<KnowledgeSection sermon={mockSermonWithInsights} updateSermon={mockUpdateSermon} />);
      
      // Wait for loading state to finish - properly wrapped in act()
      await act(async () => {
        jest.advanceTimersByTime(600);
      });
      
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument();
      });
      
      // Expand the section - wrap in act()
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
      });
      
      // Find and click the regenerate verses button
      const refreshButtons = screen.getAllByTitle('Refresh');
      fireEvent.click(refreshButtons[1]);
      
      // Wait for error to be logged
      await waitFor(() => {
        expect(console.error).toHaveBeenCalled();
      });
    } finally {
      // Restore original console.error
      console.error = originalConsoleError;
    }
  });

  it('handles API errors when regenerating directions', async () => {
    // Mock API error
    (insightsService.generatePossibleDirections as jest.Mock).mockRejectedValue(new Error('API Error'));
    
    // Spy on console.error
    const originalConsoleError = console.error;
    const mockConsoleError = jest.fn();
    
    // Set the global flag to indicate we're overriding console methods
    global.__CONSOLE_OVERRIDDEN_BY_TEST__ = true;
    console.error = mockConsoleError;
    
    try {
      render(<KnowledgeSection sermon={mockSermonWithInsights} updateSermon={mockUpdateSermon} />);
      
      // Wait for loading state to finish - properly wrapped in act()
      await act(async () => {
        jest.advanceTimersByTime(600);
      });
      
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument();
      });
      
      // Expand the section - wrap in act()
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
      });
      
      // Find and click the regenerate directions button
      const refreshButtons = screen.getAllByTitle('Refresh');
      fireEvent.click(refreshButtons[2]);
      
      // Wait for error to be logged
      await waitFor(() => {
        expect(console.error).toHaveBeenCalled();
      });
    } finally {
      // Restore original console.error
      console.error = originalConsoleError;
    }
  });

  it('does nothing when regenerate is clicked but no sermon id is available', async () => {
    // Mock console.error to capture the error
    const originalConsoleError = console.error;
    const mockConsoleError = jest.fn();
    console.error = mockConsoleError;
    global.__CONSOLE_OVERRIDDEN_BY_TEST__ = true;
    
    try {
      const sermonWithoutId = { ...mockSermonWithInsights, id: undefined };
      
      render(<KnowledgeSection sermon={sermonWithoutId as any} updateSermon={mockUpdateSermon} />);
      
      // Wait for loading state to finish - properly wrapped in act()
      await act(async () => {
        jest.advanceTimersByTime(600);
      });
      
      // Expand the section - wrap in act()
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
      });
      
      // Clear mocks before testing
      jest.clearAllMocks();
      
      // Find and click the regenerate topics button - wrap in act to catch console.error
      await act(async () => {
        const refreshButtons = screen.getAllByTitle('Refresh');
        fireEvent.click(refreshButtons[0]);
      });
      
      // Verify that console.error was called with expected message
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('Cannot generate topics: sermon or sermon.id is missing')
      );
      
      // Verify no API calls were made
      expect(insightsService.generateTopics).not.toHaveBeenCalled();
    } finally {
      // Restore original console.error
      console.error = originalConsoleError;
      global.__CONSOLE_OVERRIDDEN_BY_TEST__ = false;
    }
  });

  it('does nothing when generate all is clicked but updateSermon is not provided', async () => {
    // Mock console.error to capture the error
    const originalConsoleError = console.error;
    const mockConsoleError = jest.fn();
    console.error = mockConsoleError;
    global.__CONSOLE_OVERRIDDEN_BY_TEST__ = true;
    
    try {
      render(<KnowledgeSection sermon={mockSermonWithoutInsights} />);
      
      // Wait for loading state to finish - properly wrapped in act()
      await act(async () => {
        jest.advanceTimersByTime(600);
      });
      
      // Clear mocks before testing
      jest.clearAllMocks();
      
      // Click generate button - wrap in act()
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Generate Insights' }));
      });
      
      // Verify no API calls were made
      expect(insightsService.generateInsights).not.toHaveBeenCalled();
    } finally {
      // Restore original console.error
      console.error = originalConsoleError;
      global.__CONSOLE_OVERRIDDEN_BY_TEST__ = false;
    }
  });
}); 