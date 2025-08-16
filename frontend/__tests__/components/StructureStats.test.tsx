import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import StructureStats from '../../app/components/sermon/StructureStats';
import { Sermon } from '../../app/models/models';

// Mock next/navigation
const mockUseRouter = jest.fn();
const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

// Mock react-i18next
const mockUseTranslation = jest.fn();
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: any) => {
      const translations: { [key: string]: string } = {
        'structure.title': 'Sermon Structure',
        'structure.entries': 'entries',
        'structure.recommended': `Recommended: ${options?.percent || 0}%`,
        'structure.workButton': 'Work on Structure',
        'structure.focusMode': 'Focus Mode',
        'structure.inconsistentTagsWarning': 'Some thoughts have tag inconsistencies. Please fix them before working on structure.',
        'tags.introduction': 'Introduction',
        'tags.mainPart': 'Main Part',
        'tags.conclusion': 'Conclusion',
        'plan.pageTitle': 'Plan',
      };
      return translations[key] || key;
    },
  }),
}));

// Mock themeColors
jest.mock('@/utils/themeColors', () => ({
  SERMON_SECTION_COLORS: {
    introduction: {
      base: "#d97706"
    },
    mainPart: {
      base: "#2563eb"
    },
    conclusion: {
      base: "#16a34a"
    }
  },
  getFocusModeButtonColors: (section: string) => {
    const colors = {
      introduction: { bg: 'bg-amber-500', hover: 'hover:bg-amber-600', text: 'text-white' },
      mainPart: { bg: 'bg-blue-500', hover: 'hover:bg-blue-600', text: 'text-white' },
      conclusion: { bg: 'bg-green-500', hover: 'hover:bg-green-600', text: 'text-white' }
    };
    return colors[section as keyof typeof colors] || colors.introduction;
  }
}));

// Mock urlUtils
jest.mock('@/utils/urlUtils', () => ({
  getFocusModeUrl: (section: string, sermonId: string) => `/structure?mode=focus&section=${section}&sermonId=${sermonId}`
}));

describe('StructureStats Component', () => {
  beforeEach(() => {
    mockPush.mockClear();
  });
  
  // Sample data for testing
  const mockSermon: Sermon = {
    id: 'sermon1',
    title: 'Test Sermon',
    verse: 'John 3:16',
    date: '2023-01-01',
    thoughts: [],
    userId: 'user1',
    structure: {
      introduction: [],
      main: [],
      conclusion: [],
      ambiguous: [],
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
      <StructureStats 
        sermon={mockSermon} 
        tagCounts={mockTagCounts} 
        totalThoughts={totalThoughts} 
      />
    );

    // Check if the title is rendered
    expect(screen.getByText('Sermon Structure')).toBeInTheDocument();

    // Check if the percentages are displayed correctly - there are 3 elements with 33%
    const percentElements = screen.getAllByText('33%');
    expect(percentElements).toHaveLength(3); // One for each section
    
    // Check if the recommended percentages are displayed
    const recommended20Elements = screen.getAllByText((content, element) => {
      return element?.textContent?.includes('Recommended: 20%') || false;
    });
    expect(recommended20Elements.length).toBeGreaterThan(0); // At least one element with 20%
    
    const recommended60Elements = screen.getAllByText((content, element) => {
      return element?.textContent?.includes('Recommended: 60%') || false;
    });
    expect(recommended60Elements.length).toBeGreaterThan(0); // At least one element with 60%
  });

  it('displays Focus mode buttons for each section', () => {
    render(
      <StructureStats 
        sermon={mockSermon} 
        tagCounts={mockTagCounts} 
        totalThoughts={totalThoughts} 
      />
    );

    // Check if Focus mode buttons are rendered for each section
    const focusModeButtons = screen.getAllByText('Focus Mode');
    expect(focusModeButtons).toHaveLength(3); // One for each section
    
    // Check if buttons have correct links
    focusModeButtons.forEach((button, index) => {
      const sections = ['introduction', 'main', 'conclusion'];
      const expectedHref = `/structure?mode=focus&section=${sections[index]}&sermonId=${mockSermon.id}`;
      expect(button.closest('a')).toHaveAttribute('href', expectedHref);
    });
  });

  it('navigates to structure page when work button is clicked', () => {
    render(
      <StructureStats 
        sermon={mockSermon} 
        tagCounts={mockTagCounts} 
        totalThoughts={totalThoughts} 
      />
    );

    // Find and click the structure button
    const structureButton = screen.getByText('Work on Structure');
    fireEvent.click(structureButton);

    // Check if navigation was triggered
    expect(mockPush).toHaveBeenCalledWith(`/structure?sermonId=${mockSermon.id}`);
  });

  it('navigates to plan page when plan button is clicked', () => {
    render(
      <StructureStats 
        sermon={mockSermon} 
        tagCounts={mockTagCounts} 
        totalThoughts={totalThoughts} 
      />
    );

    // Find and click the plan button
    const planButton = screen.getByText('Plan');
    fireEvent.click(planButton);

    // Check if navigation was triggered
    expect(mockPush).toHaveBeenCalledWith(`/sermons/${mockSermon.id}/plan`);
  });

  it('disables work button when thoughts have inconsistencies', () => {
    render(
      <StructureStats 
        sermon={mockSermon} 
        tagCounts={mockTagCounts} 
        totalThoughts={totalThoughts}
        hasInconsistentThoughts={true}
      />
    );

    // Find the button and check if it's disabled
    const structureButton = screen.getByText('Work on Structure');
    expect(structureButton).toBeDisabled();
    
    // Check if tooltip/title contains warning message
    expect(structureButton).toHaveAttribute('title', 'Some thoughts have tag inconsistencies. Please fix them before working on structure.');
    
    // Click the button and check that navigation was not triggered
    fireEvent.click(structureButton);
    expect(mockPush).not.toHaveBeenCalled();
  });
  
  it('enables work button when thoughts have no inconsistencies', () => {
    render(
      <StructureStats 
        sermon={mockSermon} 
        tagCounts={mockTagCounts} 
        totalThoughts={totalThoughts}
        hasInconsistentThoughts={false}
      />
    );

    // Find the button and check if it's enabled
    const structureButton = screen.getByText('Work on Structure');
    expect(structureButton).not.toBeDisabled();
    
    // Check that tooltip/title is empty
    expect(structureButton).toHaveAttribute('title', '');
    
    // Click the button and check that navigation was triggered
    fireEvent.click(structureButton);
    expect(mockPush).toHaveBeenCalledWith(`/structure?sermonId=${mockSermon.id}`);
  });

  it('handles empty thoughts correctly', () => {
    const emptyTagCounts = { 'Вступление': 0, 'Основная часть': 0, 'Заключение': 0 };
    
    render(
      <StructureStats 
        sermon={mockSermon} 
        tagCounts={emptyTagCounts} 
        totalThoughts={0} 
      />
    );

    // Check if the percentages are all 0%
    expect(screen.getAllByText('0%')).toHaveLength(3);
  });

  it('displays correct progress bar with section colors', () => {
    render(
      <StructureStats 
        sermon={mockSermon} 
        tagCounts={mockTagCounts} 
        totalThoughts={totalThoughts} 
      />
    );

    // Check if progress bar sections exist with data-tooltip attributes
    const tooltipElements = document.querySelectorAll('[data-tooltip]');
    expect(tooltipElements).toHaveLength(3); // Three sections: intro, main, conclusion
    
    // Check if tooltips contain expected content
    const tooltipTexts = Array.from(tooltipElements).map(el => el.getAttribute('data-tooltip'));
    expect(tooltipTexts).toContain('Introduction: 1 entries');
    expect(tooltipTexts).toContain('Main Part: 1 entries');
    expect(tooltipTexts).toContain('Conclusion: 1 entries');
  });

  it('renders Focus mode buttons with correct styling classes', () => {
    render(
      <StructureStats 
        sermon={mockSermon} 
        tagCounts={mockTagCounts} 
        totalThoughts={totalThoughts} 
      />
    );

    const focusModeButtons = screen.getAllByText('Focus Mode');
    
    focusModeButtons.forEach((button) => {
      const link = button.closest('a');
      expect(link).toHaveClass('px-2', 'py-1', 'rounded', 'text-xs', 'transition-colors', 'block');
    });
  });
}); 