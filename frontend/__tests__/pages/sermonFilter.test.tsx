import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// Define mock data types
interface Thought {
  id: string;
  text: string;
  tags: string[];
  date: string;
}

interface ThoughtsBySection {
  introduction: string[];
  main: string[];
  conclusion: string[];
  ambiguous: string[];
}

interface Sermon {
  id: string;
  title: string;
  verse: string;
  date: string;
  userId: string;
  thoughts: Thought[];
  structure?: ThoughtsBySection;
}

// Create a mock SermonPage component that includes the filter functionality
// This is simplified but includes the key elements we need to test
const SermonPage = () => {
  const [isFilterOpen, setIsFilterOpen] = React.useState(false);
  const [viewFilter, setViewFilter] = React.useState('all');
  const filterRef = React.useRef<HTMLDivElement>(null);
  const filterButtonRef = React.useRef<HTMLButtonElement>(null);

  // Handle clicks outside the filter dropdown
  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        isFilterOpen && 
        filterRef.current && 
        !filterRef.current.contains(event.target as Node) &&
        filterButtonRef.current && 
        !filterButtonRef.current.contains(event.target as Node)
      ) {
        setIsFilterOpen(false);
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [filterRef, filterButtonRef, isFilterOpen]);

  const resetFilters = () => {
    setViewFilter('all');
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <h2>All Thoughts</h2>
        <span>0 / 3</span>
        
        <div className="relative ml-3">
          <button
            ref={filterButtonRef}
            onClick={(e) => {
              e.stopPropagation();
              setIsFilterOpen(!isFilterOpen);
            }}
            data-testid="filter-button"
          >
            Filter
            <svg className="ml-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          
          {isFilterOpen && (
            <div 
              ref={filterRef}
              onClick={(e) => e.stopPropagation()}
              data-testid="filter-dropdown"
            >
              <div>
                {/* View options */}
                <div>
                  <div>
                    <h3>View Options</h3>
                    <button 
                      onClick={() => resetFilters()}
                      data-testid="reset-button"
                    >
                      Reset
                    </button>
                  </div>
                  <div>
                    <label>
                      <input
                        type="radio"
                        name="viewFilter"
                        value="all"
                        checked={viewFilter === 'all'}
                        onChange={() => setViewFilter('all')}
                        data-testid="all-radio"
                      />
                      <span>All</span>
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="viewFilter"
                        value="missingTags"
                        checked={viewFilter === 'missingTags'}
                        onChange={() => setViewFilter('missingTags')}
                        data-testid="missing-tags-radio"
                      />
                      <span>Missing Tags</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

describe('Sermon Page Filter Functionality', () => {
  beforeEach(() => {
    // Reset any mocks before each test
    jest.clearAllMocks();
  });

  it('initially renders with filter dropdown closed', () => {
    render(<SermonPage />);
    
    // Filter button should be visible
    expect(screen.getByTestId('filter-button')).toBeInTheDocument();
    
    // Filter dropdown should not be visible
    expect(screen.queryByTestId('filter-dropdown')).not.toBeInTheDocument();
  });

  it('opens filter dropdown when clicking the filter button', async () => {
    render(<SermonPage />);
    
    // Click the filter button
    const filterButton = screen.getByTestId('filter-button');
    fireEvent.click(filterButton);
    
    // Filter dropdown should now be visible
    await waitFor(() => {
      expect(screen.getByTestId('filter-dropdown')).toBeInTheDocument();
    });
  });

  it('closes filter dropdown when clicking the filter button again', async () => {
    render(<SermonPage />);
    
    // Click the filter button to open
    const filterButton = screen.getByTestId('filter-button');
    fireEvent.click(filterButton);
    
    // Verify it's open
    await waitFor(() => {
      expect(screen.getByTestId('filter-dropdown')).toBeInTheDocument();
    });
    
    // Click the filter button again to close
    fireEvent.click(filterButton);
    
    // Filter dropdown should now be closed
    await waitFor(() => {
      expect(screen.queryByTestId('filter-dropdown')).not.toBeInTheDocument();
    });
  });

  it('keeps dropdown open when clicking inside the dropdown', async () => {
    render(<SermonPage />);
    
    // Click the filter button to open
    const filterButton = screen.getByTestId('filter-button');
    fireEvent.click(filterButton);
    
    // Verify it's open
    await waitFor(() => {
      expect(screen.getByTestId('filter-dropdown')).toBeInTheDocument();
    });
    
    // Click inside the dropdown
    const resetButton = screen.getByTestId('reset-button');
    fireEvent.click(resetButton);
    
    // Filter dropdown should remain open
    expect(screen.getByTestId('filter-dropdown')).toBeInTheDocument();
  });

  it('closes dropdown when clicking outside both button and dropdown', async () => {
    // Set up a test environment with a clearly defined "outside" area
    render(
      <div>
        <div data-testid="outside-area">Outside Area</div>
        <SermonPage />
      </div>
    );
    
    // Click the filter button to open
    const filterButton = screen.getByTestId('filter-button');
    fireEvent.click(filterButton);
    
    // Verify it's open
    await waitFor(() => {
      expect(screen.getByTestId('filter-dropdown')).toBeInTheDocument();
    });
    
    // Click outside both the button and dropdown
    const outsideArea = screen.getByTestId('outside-area');
    fireEvent.mouseDown(outsideArea);
    
    // Filter dropdown should now be closed
    await waitFor(() => {
      expect(screen.queryByTestId('filter-dropdown')).not.toBeInTheDocument();
    });
  });

  it('applies view filter when radio button is selected', async () => {
    render(<SermonPage />);
    
    // Open the filter dropdown
    const filterButton = screen.getByTestId('filter-button');
    fireEvent.click(filterButton);
    
    // Find and click the "Missing Tags" radio button
    const missingTagsRadio = screen.getByTestId('missing-tags-radio');
    fireEvent.click(missingTagsRadio);
    
    // Verify the radio button is selected
    expect(missingTagsRadio).toBeChecked();
  });

  it('resets all filters when clicking the reset button', async () => {
    render(<SermonPage />);
    
    // Open the filter dropdown
    const filterButton = screen.getByTestId('filter-button');
    fireEvent.click(filterButton);
    
    // Apply a filter first
    const missingTagsRadio = screen.getByTestId('missing-tags-radio');
    fireEvent.click(missingTagsRadio);
    expect(missingTagsRadio).toBeChecked();
    
    // Click the reset button
    const resetButton = screen.getByTestId('reset-button');
    fireEvent.click(resetButton);
    
    // Verify the "All" option is selected again
    const allRadio = screen.getByTestId('all-radio');
    expect(allRadio).toBeChecked();
  });
}); 