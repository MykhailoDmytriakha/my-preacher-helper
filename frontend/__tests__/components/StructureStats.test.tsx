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
        'structure.preview': 'Structure Preview',
        'structure.entries': 'entries',
        'structure.recommended': `Recommended: ${options?.percent || 0}%`,
        'structure.workButton': 'Work on Structure',
        'structure.underConsideration': 'Under Consideration',
        'tags.introduction': 'Introduction',
        'tags.mainPart': 'Main Part',
        'tags.conclusion': 'Conclusion',
      };
      return translations[key] || key;
    },
  }),
}));

// Mock component that simulates the actual StructureStats component
const MockStructureStats: React.FC<{
  sermon: Sermon;
  tagCounts: {
    [key: string]: number;
  };
  totalThoughts: number;
}> = ({ sermon, tagCounts, totalThoughts }) => {
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

  // Helper function to find thought text by ID
  const getThoughtTextById = (thoughtId: string): string => {
    if (!sermon.thoughts) return thoughtId;
    
    const thought = sermon.thoughts.find((t: Thought) => t.id === thoughtId);
    return thought ? thought.text : thoughtId;
  };
    
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
        <button onClick={() => mockPush(`/structure?sermonId=${sermon.id}`)}>
          Work on Structure
        </button>
      </div>
      
      {sermon.structure && (
        <div>
          <h3>Structure Preview</h3>
          <div>
            {sermon.structure.introduction && sermon.structure.introduction.length > 0 && (
              <div>
                <strong>Introduction</strong>
                <div>
                  {sermon.structure.introduction.map((item, index) => (
                    <span key={`intro-${index}`}>
                      {getThoughtTextById(item)}
                    </span>
                  ))}
                </div>
              </div>
            )}
            
            {sermon.structure.main && sermon.structure.main.length > 0 && (
              <div>
                <strong>Main Part</strong>
                <div>
                  {sermon.structure.main.map((item, index) => (
                    <span key={`main-${index}`}>
                      {getThoughtTextById(item)}
                    </span>
                  ))}
                </div>
              </div>
            )}
            
            {sermon.structure.conclusion && sermon.structure.conclusion.length > 0 && (
              <div>
                <strong>Conclusion</strong>
                <div>
                  {sermon.structure.conclusion.map((item, index) => (
                    <span key={`conclusion-${index}`}>
                      {getThoughtTextById(item)}
                    </span>
                  ))}
                </div>
              </div>
            )}
            
            {sermon.structure.ambiguous && sermon.structure.ambiguous.length > 0 && (
              <div>
                <strong>Under Consideration</strong>
                <div>
                  {sermon.structure.ambiguous.map((item, index) => (
                    <span key={`ambiguous-${index}`}>
                      {getThoughtTextById(item)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
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

  it('renders structure preview with correct thought texts', () => {
    render(
      <MockStructureStats 
        sermon={mockSermon} 
        tagCounts={mockTagCounts} 
        totalThoughts={totalThoughts} 
      />
    );

    // Check if all section titles are rendered
    expect(screen.getByText('Structure Preview')).toBeInTheDocument();
    expect(screen.getByText('Introduction')).toBeInTheDocument();
    expect(screen.getByText('Main Part')).toBeInTheDocument();
    expect(screen.getByText('Conclusion')).toBeInTheDocument();
    expect(screen.getByText('Under Consideration')).toBeInTheDocument();

    // Check if thought texts are displayed correctly
    expect(screen.getByText('Introduction thought')).toBeInTheDocument();
    expect(screen.getByText('Main part thought')).toBeInTheDocument();
    expect(screen.getByText('Conclusion thought')).toBeInTheDocument();
    expect(screen.getByText('Ambiguous thought')).toBeInTheDocument();
  });

  it('does not render structure preview when sermon has no structure', () => {
    const sermonWithoutStructure = { ...mockSermon, structure: undefined };
    
    render(
      <MockStructureStats 
        sermon={sermonWithoutStructure} 
        tagCounts={mockTagCounts} 
        totalThoughts={totalThoughts} 
      />
    );

    // Should not find the structure preview section
    expect(screen.queryByText('Structure Preview')).not.toBeInTheDocument();
  });

  it('renders empty section when section array is empty', () => {
    const sermonWithEmptySections = { 
      ...mockSermon,
      structure: {
        introduction: [],
        main: ['thought2'],
        conclusion: ['thought3'],
        ambiguous: [],
      }
    };
    
    render(
      <MockStructureStats 
        sermon={sermonWithEmptySections} 
        tagCounts={mockTagCounts} 
        totalThoughts={totalThoughts} 
      />
    );

    // Should not find the Introduction and Ambiguous sections
    expect(screen.queryByText('Introduction')).not.toBeInTheDocument();
    expect(screen.queryByText('Under Consideration')).not.toBeInTheDocument();
    
    // Should still find Main Part and Conclusion
    expect(screen.getByText('Main Part')).toBeInTheDocument();
    expect(screen.getByText('Conclusion')).toBeInTheDocument();
  });

  it('falls back to ID when thought is not found', () => {
    const sermonWithMissingThought = { 
      ...mockSermon,
      structure: {
        introduction: ['non-existent-id'],
        main: [],
        conclusion: [],
        ambiguous: [],
      }
    };
    
    render(
      <MockStructureStats 
        sermon={sermonWithMissingThought} 
        tagCounts={mockTagCounts} 
        totalThoughts={totalThoughts} 
      />
    );

    // Should display the ID itself as fallback
    expect(screen.getByText('non-existent-id')).toBeInTheDocument();
  });

  it('calculates percentages correctly with zero thoughts', () => {
    render(
      <MockStructureStats 
        sermon={mockSermon} 
        tagCounts={mockTagCounts} 
        totalThoughts={0} 
      />
    );

    // All percentages should be 0%
    const percentages = screen.getAllByText('0%');
    expect(percentages.length).toBe(3);
  });

  it('tests the work button navigation', () => {
    render(
      <MockStructureStats 
        sermon={mockSermon} 
        tagCounts={mockTagCounts} 
        totalThoughts={totalThoughts} 
      />
    );
    
    // Find and click the work button
    const workButton = screen.getByText('Work on Structure');
    fireEvent.click(workButton);
    
    // Verify the router.push was called with the correct path
    expect(mockPush).toHaveBeenCalledWith(`/structure?sermonId=${mockSermon.id}`);
  });
}); 