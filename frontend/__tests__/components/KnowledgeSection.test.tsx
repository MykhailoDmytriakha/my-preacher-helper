import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Sermon, Insights } from '@/models/models';
import KnowledgeSection from '@/components/sermon/KnowledgeSection';
import * as insightsService from '@/services/insights.service';

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
    t: (key: string) => {
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
    relatedVerses: ['Romans 5:8', 'Ephesians 2:8-9'],
    possibleDirections: ['Focus on God\'s love', 'Explain the concept of grace']
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
      relatedVerses: ['John 3:16', 'Romans 8:28']
    });
    (insightsService.generatePossibleDirections as jest.Mock).mockResolvedValue({
      ...mockInsights,
      possibleDirections: ['New direction 1', 'New direction 2']
    });
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  it('renders without insights and shows generate button', async () => {
    render(<KnowledgeSection sermon={mockSermonWithoutInsights} updateSermon={mockUpdateSermon} />);
    
    // Wait for loading state to finish
    act(() => {
      jest.advanceTimersByTime(600);
    });
    
    await waitFor(() => {
      expect(screen.getByText('Knowledge and Insights')).toBeInTheDocument();
    });
    
    expect(screen.getByText('No insights have been generated yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate Insights' })).toBeInTheDocument();
  });

  it('renders with insights in collapsed state', async () => {
    render(<KnowledgeSection sermon={mockSermonWithInsights} updateSermon={mockUpdateSermon} />);
    
    // Wait for loading state to finish
    act(() => {
      jest.advanceTimersByTime(600);
    });
    
    await waitFor(() => {
      expect(screen.getByText('Knowledge and Insights')).toBeInTheDocument();
    });
    
    expect(screen.getByText('Click to expand insights')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument();
  });

  it('expands and collapses when the button is clicked', async () => {
    render(<KnowledgeSection sermon={mockSermonWithInsights} updateSermon={mockUpdateSermon} />);
    
    // Wait for loading state to finish
    act(() => {
      jest.advanceTimersByTime(600);
    });
    
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument();
    });
    
    // Initially collapsed
    expect(screen.queryByText('Covered Topics')).not.toBeInTheDocument();
    
    // Click to expand
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    
    // Should now show sections
    expect(screen.getByText('Covered Topics')).toBeInTheDocument();
    expect(screen.getByText('Related Verses')).toBeInTheDocument();
    expect(screen.getByText('Possible Directions')).toBeInTheDocument();
    
    // Click to collapse
    fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
    
    // Sections should be hidden again
    expect(screen.queryByText('Covered Topics')).not.toBeInTheDocument();
  });

  it('generates all insights when button is clicked', async () => {
    render(<KnowledgeSection sermon={mockSermonWithoutInsights} updateSermon={mockUpdateSermon} />);
    
    // Wait for loading state to finish
    act(() => {
      jest.advanceTimersByTime(600);
    });
    
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Generate Insights' })).toBeInTheDocument();
    });
    
    // Clear previous mocks
    jest.clearAllMocks();
    
    // Click generate button
    fireEvent.click(screen.getByRole('button', { name: 'Generate Insights' }));
    
    // Should show loading state
    expect(screen.getByText('Generating...')).toBeInTheDocument();
    
    // Wait for API call to resolve
    await waitFor(() => {
      expect(mockUpdateSermon).toHaveBeenCalled();
    });
  });

  it('shows and hides topics when toggle is clicked', async () => {
    render(<KnowledgeSection sermon={mockSermonWithInsights} updateSermon={mockUpdateSermon} />);
    
    // Wait for loading state to finish
    act(() => {
      jest.advanceTimersByTime(600);
    });
    
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument();
    });
    
    // Expand the section
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    
    // Topics should be visible by default
    expect(screen.getByText('Faith')).toBeInTheDocument();
    expect(screen.getByText('Love')).toBeInTheDocument();
    expect(screen.getByText('Redemption')).toBeInTheDocument();
    
    // Get all Hide all buttons and click the first one (for topics)
    const hideButtons = screen.getAllByText('Hide all');
    fireEvent.click(hideButtons[0]);
    
    // Topics should be hidden
    expect(screen.queryByText('Faith')).not.toBeInTheDocument();
    
    // Get all Show all buttons and click the first one
    const showButtons = screen.getAllByText('Show all');
    fireEvent.click(showButtons[0]);
    
    // Topics should be visible again
    expect(screen.getByText('Faith')).toBeInTheDocument();
  });

  it('regenerates topics when the refresh button is clicked', async () => {
    render(<KnowledgeSection sermon={mockSermonWithInsights} updateSermon={mockUpdateSermon} />);
    
    // Wait for loading state to finish
    act(() => {
      jest.advanceTimersByTime(600);
    });
    
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument();
    });
    
    // Expand the section
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    
    // Find and click the regenerate topics button
    const refreshButtons = screen.getAllByTitle('Refresh');
    fireEvent.click(refreshButtons[0]); // First refresh button is for topics
    
    // Should show loading spinner
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
    
    // Wait for API call to resolve
    await waitFor(() => {
      expect(insightsService.generateTopics).toHaveBeenCalledWith('sermon1');
      expect(mockUpdateSermon).toHaveBeenCalledWith(expect.objectContaining({
        id: 'sermon1',
        insights: expect.objectContaining({
          topics: ['New Faith', 'New Love', 'New Redemption']
        })
      }));
    });
  });

  it('regenerates verses when the refresh button is clicked', async () => {
    render(<KnowledgeSection sermon={mockSermonWithInsights} updateSermon={mockUpdateSermon} />);
    
    // Wait for loading state to finish
    act(() => {
      jest.advanceTimersByTime(600);
    });
    
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument();
    });
    
    // Expand the section
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    
    // Find and click the regenerate verses button
    const refreshButtons = screen.getAllByTitle('Refresh');
    fireEvent.click(refreshButtons[1]); // Second refresh button is for verses
    
    // Wait for API call to resolve
    await waitFor(() => {
      expect(insightsService.generateRelatedVerses).toHaveBeenCalledWith('sermon1');
      expect(mockUpdateSermon).toHaveBeenCalledWith(expect.objectContaining({
        id: 'sermon1',
        insights: expect.objectContaining({
          relatedVerses: ['John 3:16', 'Romans 8:28']
        })
      }));
    });
  });

  it('regenerates directions when the refresh button is clicked', async () => {
    render(<KnowledgeSection sermon={mockSermonWithInsights} updateSermon={mockUpdateSermon} />);
    
    // Wait for loading state to finish
    act(() => {
      jest.advanceTimersByTime(600);
    });
    
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument();
    });
    
    // Expand the section
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    
    // Find and click the regenerate directions button
    const refreshButtons = screen.getAllByTitle('Refresh');
    fireEvent.click(refreshButtons[2]); // Third refresh button is for directions
    
    // Wait for API call to resolve
    await waitFor(() => {
      expect(insightsService.generatePossibleDirections).toHaveBeenCalledWith('sermon1');
      expect(mockUpdateSermon).toHaveBeenCalledWith(expect.objectContaining({
        id: 'sermon1',
        insights: expect.objectContaining({
          possibleDirections: ['New direction 1', 'New direction 2']
        })
      }));
    });
  });

  it('handles API errors when generating all insights', async () => {
    // Mock the API to reject the promise
    const error = new Error('API Error');
    (insightsService.generateInsights as jest.Mock).mockRejectedValueOnce(error);
    
    // Spy on console.error
    const originalConsoleError = console.error;
    const mockConsoleError = jest.fn();
    console.error = mockConsoleError;
    
    try {
      // Render with sermon that has no insights
      const { getByText } = render(
        <KnowledgeSection
          sermon={{
            id: 'test-sermon',
            title: 'Test Sermon',
            verse: 'John 3:16',
            date: '2023-01-01',
            thoughts: [],
            userId: 'user1',
          }}
          updateSermon={mockUpdateSermon}
        />
      );
      
      // Wait for initial loading
      act(() => {
        jest.advanceTimersByTime(600);
      });
      
      // Click generate button
      fireEvent.click(getByText('Generate Insights'));
      
      // Wait for API error to be processed
      await waitFor(() => {
        expect(mockConsoleError).toHaveBeenCalled();
      });
    } finally {
      // Restore original console.error
      console.error = originalConsoleError;
    }
  });

  it('handles API errors when regenerating topics', async () => {
    // Mock API error
    (insightsService.generateTopics as jest.Mock).mockRejectedValue(new Error('API Error'));
    
    // Spy on console.error
    jest.spyOn(console, 'error').mockImplementation(() => {});
    
    render(<KnowledgeSection sermon={mockSermonWithInsights} updateSermon={mockUpdateSermon} />);
    
    // Wait for loading state to finish
    act(() => {
      jest.advanceTimersByTime(600);
    });
    
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument();
    });
    
    // Expand the section
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    
    // Find and click the regenerate topics button
    const refreshButtons = screen.getAllByTitle('Refresh');
    fireEvent.click(refreshButtons[0]);
    
    // Wait for error to be logged
    await waitFor(() => {
      expect(console.error).toHaveBeenCalled();
    });
  });

  it('does nothing when regenerate is clicked but no sermon id is available', async () => {
    const sermonWithoutId = { ...mockSermonWithInsights, id: undefined };
    
    render(<KnowledgeSection sermon={sermonWithoutId as any} updateSermon={mockUpdateSermon} />);
    
    // Wait for loading state to finish
    act(() => {
      jest.advanceTimersByTime(600);
    });
    
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument();
    });
    
    // Expand the section
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    
    // Find and click the regenerate topics button
    const refreshButtons = screen.getAllByTitle('Refresh');
    fireEvent.click(refreshButtons[0]);
    
    // Wait a bit to ensure no API calls
    await waitFor(() => {
      expect(insightsService.generateTopics).not.toHaveBeenCalled();
    });
  });

  it('does nothing when generate all is clicked but updateSermon is not provided', async () => {
    render(<KnowledgeSection sermon={mockSermonWithoutInsights} />);
    
    // Wait for loading state to finish
    act(() => {
      jest.advanceTimersByTime(600);
    });
    
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Generate Insights' })).toBeInTheDocument();
    });
    
    // Click generate button
    fireEvent.click(screen.getByRole('button', { name: 'Generate Insights' }));
    
    // Wait a bit to ensure no API calls
    await waitFor(() => {
      expect(insightsService.generateInsights).not.toHaveBeenCalled();
    });
  });
}); 