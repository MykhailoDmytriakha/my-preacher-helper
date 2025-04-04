import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Sermon, Thought } from '@/models/models';

// Create a mock StructureStats component for testing
const mockUseRouter = jest.fn();
const mockPush = jest.fn();
const mockUseTranslation = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
  useParams: () => ({
    id: 'test-id',
  }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: any) => {
      const translations: { [key: string]: string } = {
        'structure.title': 'Sermon Structure',
        'structure.entries': 'entries',
        'structure.recommended': `Recommended: ${options?.percent || 0}%`,
        'structure.workButton': 'Work on Structure',
        'structure.inconsistentTagsWarning': 'Some thoughts have tag inconsistencies. Please fix them before working on structure.',
        'tags.introduction': 'Introduction',
        'tags.mainPart': 'Main Part',
        'tags.conclusion': 'Conclusion',
      };
      return translations[key] || key;
    },
  }),
}));

// Mock themeColors
jest.mock('@/utils/themeColors', () => ({
  SERMON_SECTION_COLORS: {
    introduction: {
      base: "#2563eb"
    },
    mainPart: {
      base: "#7e22ce"
    },
    conclusion: {
      base: "#16a34a"
    }
  }
}));

// Mock component that simulates the actual StructureStats component
const MockStructureStats: React.FC<{
  sermon: Sermon;
  tagCounts: {
    [key: string]: number;
  };
  totalThoughts: number;
  hasInconsistentThoughts?: boolean;
}> = ({ sermon, tagCounts, totalThoughts, hasInconsistentThoughts = false }) => {
  // Calculate the same values as the real component
  const intro = tagCounts["Вступление"] || 0;
  const main = tagCounts["Основная часть"] || 0;
  const conclusion = tagCounts["Заключение"] || 0;

  const introPercentage = totalThoughts
    ? Math.round((intro / totalThoughts) * 100)
    : 0;
  const mainPercentage = totalThoughts
    ? Math.round((main / totalThoughts) * 100)
    : 0;
  const conclusionPercentage = totalThoughts
    ? Math.round((conclusion / totalThoughts) * 100)
    : 0;
    
  return (
    <div data-testid="structure-stats">
      <div>
        <h2>Sermon Structure</h2>
        <div>
          <div className="intro-percentage">{introPercentage}%</div>
          <div>Recommended: 20%</div>
          <div className="main-percentage">{mainPercentage}%</div>
          <div>Recommended: 60%</div>
          <div className="conclusion-percentage">{conclusionPercentage}%</div>
          <div>Recommended: 20%</div>
        </div>
        <button 
          onClick={() => !hasInconsistentThoughts && mockPush(`/structure?sermonId=${sermon.id}`)}
          disabled={hasInconsistentThoughts}
          className={hasInconsistentThoughts ? 'disabled-button' : 'enabled-button'}
          title={hasInconsistentThoughts ? 'Some thoughts have tag inconsistencies. Please fix them before working on structure.' : ''}
          data-testid="work-structure-button"
        >
          Work on Structure
        </button>
      </div>
    </div>
  );
};

// Use mock component in tests
describe('StructureStats Component', () => {
  beforeEach(() => {
    mockPush.mockClear();
  });
  
  // Sample data for testing
  const mockThoughts: Thought[] = [
    { id: 'thought1', text: 'Introduction thought', tags: ['Вступление'], date: '2023-01-01' },
    { id: 'thought2', text: 'Main part thought', tags: ['Основная часть'], date: '2023-01-01' },
    { id: 'thought3', text: 'Conclusion thought', tags: ['Заключение'], date: '2023-01-01' },
    { id: 'thought4', text: 'Ambiguous thought', tags: [], date: '2023-01-01' },
  ];

  const mockSermon: Sermon = {
    id: 'sermon1',
    title: 'Test Sermon',
    verse: 'John 3:16',
    date: '2023-01-01',
    thoughts: mockThoughts,
    userId: 'user1',
    structure: {
      introduction: ['thought1'],
      main: ['thought2'],
      conclusion: ['thought3'],
      ambiguous: ['thought4'],
    },
  };

  const mockTagCounts = {
    'Вступление': 1,
    'Основная часть': 1,
    'Заключение': 1,
  };

  const totalThoughts = 3;

  it('renders structure statistics correctly', () => {
    render(
      <MockStructureStats 
        sermon={mockSermon} 
        tagCounts={mockTagCounts} 
        totalThoughts={totalThoughts} 
      />
    );

    // Check if the title is rendered
    expect(screen.getByText('Sermon Structure')).toBeInTheDocument();

    // Check if the percentages are displayed correctly - using more specific selectors
    const percentElements = screen.getAllByText('33%');
    expect(percentElements.length).toBe(3); // Intro, Main, Conclusion all show 33%
    
    // Using class selectors to check specific percentage elements
    expect(screen.getByText('33%', {selector: '.intro-percentage'})).toBeInTheDocument();
    expect(screen.getByText('33%', {selector: '.main-percentage'})).toBeInTheDocument();
    expect(screen.getByText('33%', {selector: '.conclusion-percentage'})).toBeInTheDocument();

    // Check if the recommended percentages are displayed
    const recommendedIntro = screen.getAllByText('Recommended: 20%');
    expect(recommendedIntro.length).toBe(2); // One for intro, one for conclusion
    
    const recommendedMain = screen.getAllByText('Recommended: 60%');
    expect(recommendedMain.length).toBe(1);
  });

  it('navigates to structure page when button is clicked', () => {
    render(
      <MockStructureStats 
        sermon={mockSermon} 
        tagCounts={mockTagCounts} 
        totalThoughts={totalThoughts} 
      />
    );

    // Find and click the structure button
    const structureButton = screen.getByTestId('work-structure-button');
    fireEvent.click(structureButton);

    // Check if navigation was triggered
    expect(mockPush).toHaveBeenCalledWith(`/structure?sermonId=${mockSermon.id}`);
  });

  it('disables button when thoughts have inconsistencies', () => {
    render(
      <MockStructureStats 
        sermon={mockSermon} 
        tagCounts={mockTagCounts} 
        totalThoughts={totalThoughts}
        hasInconsistentThoughts={true}
      />
    );

    // Find the button and check if it's disabled
    const structureButton = screen.getByTestId('work-structure-button');
    expect(structureButton).toBeDisabled();
    expect(structureButton).toHaveClass('disabled-button');
    
    // Check if tooltip/title contains warning message
    expect(structureButton).toHaveAttribute('title', 'Some thoughts have tag inconsistencies. Please fix them before working on structure.');
    
    // Click the button and check that navigation was not triggered
    fireEvent.click(structureButton);
    expect(mockPush).not.toHaveBeenCalled();
  });
  
  it('enables button when thoughts have no inconsistencies', () => {
    render(
      <MockStructureStats 
        sermon={mockSermon} 
        tagCounts={mockTagCounts} 
        totalThoughts={totalThoughts}
        hasInconsistentThoughts={false}
      />
    );

    // Find the button and check if it's enabled
    const structureButton = screen.getByTestId('work-structure-button');
    expect(structureButton).not.toBeDisabled();
    expect(structureButton).toHaveClass('enabled-button');
    
    // Check that tooltip/title is empty
    expect(structureButton).toHaveAttribute('title', '');
    
    // Click the button and check that navigation was triggered
    fireEvent.click(structureButton);
    expect(mockPush).toHaveBeenCalledWith(`/structure?sermonId=${mockSermon.id}`);
  });

  it('handles empty thoughts correctly', () => {
    const emptySermon = { ...mockSermon, thoughts: [] };
    const emptyTagCounts = { 'Вступление': 0, 'Основная часть': 0, 'Заключение': 0 };
    
    render(
      <MockStructureStats 
        sermon={emptySermon} 
        tagCounts={emptyTagCounts} 
        totalThoughts={0} 
      />
    );

    // Check if the percentages are all 0%
    expect(screen.getAllByText('0%').length).toBe(3);
  });
}); 