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
  UI_COLORS: {
    button: {
      structure: {
        bg: "bg-amber-600",
        hover: "hover:bg-amber-700",
        darkBg: "bg-amber-500",
        darkHover: "hover:bg-amber-400",
        text: "text-white",
      },
      plan: {
        bg: "bg-blue-600",
        hover: "hover:bg-blue-700",
        darkBg: "bg-blue-500",
        darkHover: "hover:bg-blue-400",
        text: "text-white",
      },
      switcher: {
        gradient: "from-violet-600 to-fuchsia-600",
        darkGradient: "from-violet-500 to-fuchsia-500",
        border: "border-gray-200",
        darkBorder: "border-gray-700",
        bg: "bg-white",
        darkBg: "bg-gray-800",
        activeText: "text-white",
        inactiveText: "text-gray-700",
        darkInactiveText: "text-gray-200",
      },
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
  getFocusModeUrl: (section: string, sermonId: string) => `/sermons/${sermonId}/structure?mode=focus&section=${section}`
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
      const expectedHref = `/sermons/${mockSermon.id}/structure?mode=focus&section=${sections[index]}`;
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
    expect(mockPush).toHaveBeenCalledWith(`/sermons/${mockSermon.id}/structure`);
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

    const structureButton = screen.getByText('Work on Structure');
    expect(structureButton).toBeDisabled();
    expect(structureButton).toHaveAttribute('title', 'Some thoughts have tag inconsistencies. Please fix them before working on structure.');
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

    const structureButton = screen.getByText('Work on Structure');
    expect(structureButton).not.toBeDisabled();
    expect(structureButton).toHaveAttribute('title', '');
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
      expect(link).toHaveClass('inline-flex', 'items-center', 'justify-center', 'h-9', 'px-3', 'rounded', 'text-xs', 'transition-colors');
    });
  });

  // New tests for switcher-style buttons
  it('renders switcher-style toggle with gradient background', () => {
    render(
      <StructureStats 
        sermon={mockSermon} 
        tagCounts={mockTagCounts} 
        totalThoughts={totalThoughts} 
      />
    );

    // Check if the toggle container has correct classes by finding it directly
    const toggleContainer = document.querySelector('.relative.inline-flex.items-center.rounded-full.border');
    expect(toggleContainer).toBeInTheDocument();
    expect(toggleContainer).toHaveClass(
      'relative',
      'inline-flex',
      'items-center',
      'rounded-full',
      'border',
      'border-gray-200',
      'dark:border-gray-700',
      'bg-white',
      'dark:bg-gray-800',
      'overflow-hidden',
      'w-full',
      'shadow-sm',
      'hover:shadow-md',
      'transition-shadow',
      'duration-200'
    );
  });

  it('displays gradient background with correct colors', () => {
    render(
      <StructureStats 
        sermon={mockSermon} 
        tagCounts={mockTagCounts} 
        totalThoughts={totalThoughts} 
      />
    );

    // Check if gradient background exists with correct classes
    const gradientElement = document.querySelector('.bg-gradient-to-r.from-violet-600.to-fuchsia-600');
    expect(gradientElement).toBeInTheDocument();
    
    // Check dark mode gradient classes
    expect(gradientElement).toHaveClass('dark:from-violet-500', 'dark:to-fuchsia-500');
  });

  it('shows white separator line between buttons', () => {
    render(
      <StructureStats 
        sermon={mockSermon} 
        tagCounts={mockTagCounts} 
        totalThoughts={totalThoughts} 
      />
    );

    // Check if separator line exists with correct styling
    const separator = document.querySelector('.w-0\\.5.h-6.bg-white\\/90.dark\\:bg-white\\/70');
    expect(separator).toBeInTheDocument();
    
    // Check separator classes
    expect(separator).toHaveClass(
      'relative',
      'z-20',
      'w-0.5',
      'h-6',
      'bg-white/90',
      'dark:bg-white/70',
      'mx-1',
      'rounded-full',
      'shadow-sm'
    );
  });

  it('applies correct opacity to gradient when thoughts have inconsistencies', () => {
    render(
      <StructureStats 
        sermon={mockSermon} 
        tagCounts={mockTagCounts} 
        totalThoughts={totalThoughts} 
        hasInconsistentThoughts={true}
      />
    );

    // Check if gradient has reduced opacity
    const gradientElement = document.querySelector('.bg-gradient-to-r.from-violet-600.to-fuchsia-600');
    expect(gradientElement).toHaveStyle({ opacity: '0.3' });
  });

  it('applies full opacity to gradient when thoughts have no inconsistencies', () => {
    render(
      <StructureStats 
        sermon={mockSermon} 
        tagCounts={mockTagCounts} 
        totalThoughts={totalThoughts} 
        hasInconsistentThoughts={false}
      />
    );

    // Check if gradient has full opacity
    const gradientElement = document.querySelector('.bg-gradient-to-r.from-violet-600.to-fuchsia-600');
    expect(gradientElement).toHaveStyle({ opacity: '1' });
  });

  it('renders buttons with correct flex layout and sizing', () => {
    render(
      <StructureStats 
        sermon={mockSermon} 
        tagCounts={mockTagCounts} 
        totalThoughts={totalThoughts} 
      />
    );

    const structureButton = screen.getByText('Work on Structure');
    const planButton = screen.getByText('Plan');

    // Check if both buttons have flex-1 class for equal width
    expect(structureButton).toHaveClass('flex-1');
    expect(planButton).toHaveClass('flex-1');
  });

  it('applies correct hover effects to buttons', () => {
    render(
      <StructureStats 
        sermon={mockSermon} 
        tagCounts={mockTagCounts} 
        totalThoughts={totalThoughts} 
      />
    );

    const structureButton = screen.getByText('Work on Structure');
    const planButton = screen.getByText('Plan');

    // Check hover effects
    expect(structureButton).toHaveClass('hover:scale-105', 'hover:shadow-lg');
    expect(planButton).toHaveClass('hover:scale-105', 'hover:shadow-lg');
  });

  it('applies correct active effects to buttons', () => {
    render(
      <StructureStats 
        sermon={mockSermon} 
        tagCounts={mockTagCounts} 
        totalThoughts={totalThoughts} 
      />
    );

    const structureButton = screen.getByText('Work on Structure');
    const planButton = screen.getByText('Plan');

    // Check active effects
    expect(structureButton).toHaveClass('active:scale-95');
    expect(planButton).toHaveClass('active:scale-95');
  });

  it('renders buttons with correct rounded corners', () => {
    render(
      <StructureStats 
        sermon={mockSermon} 
        tagCounts={mockTagCounts} 
        totalThoughts={totalThoughts} 
      />
    );

    const structureButton = screen.getByText('Work on Structure');
    const planButton = screen.getByText('Plan');

    // Check rounded corners
    expect(structureButton).toHaveClass('rounded-l-full');
    expect(planButton).toHaveClass('rounded-r-full');
  });

  it('applies correct z-index layering', () => {
    render(
      <StructureStats 
        sermon={mockSermon} 
        tagCounts={mockTagCounts} 
        totalThoughts={totalThoughts} 
      />
    );

    const structureButton = screen.getByText('Work on Structure');
    const planButton = screen.getByText('Plan');
    const separator = document.querySelector('.w-0\\.5.h-6.bg-white\\/90.dark\\:bg-white\\/70');

    // Check z-index values
    expect(structureButton).toHaveClass('relative', 'z-10');
    expect(planButton).toHaveClass('relative', 'z-10');
    expect(separator).toHaveClass('relative', 'z-20');
  });

  it('handles button click prevention when thoughts have inconsistencies', () => {
    render(
      <StructureStats 
        sermon={mockSermon} 
        tagCounts={mockTagCounts} 
        totalThoughts={totalThoughts} 
        hasInconsistentThoughts={true}
      />
    );

    const structureButton = screen.getByText('Work on Structure');
    
    // Click should not trigger navigation
    fireEvent.click(structureButton);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('maintains consistent button text and translations', () => {
    render(
      <StructureStats 
        sermon={mockSermon} 
        tagCounts={mockTagCounts} 
        totalThoughts={totalThoughts} 
      />
    );

    // Check button text
    expect(screen.getByText('Work on Structure')).toBeInTheDocument();
    expect(screen.getByText('Plan')).toBeInTheDocument();
  });

  it('applies correct transition effects', () => {
    render(
      <StructureStats 
        sermon={mockSermon} 
        tagCounts={mockTagCounts} 
        totalThoughts={totalThoughts} 
      />
    );

    const toggleContainer = document.querySelector('.relative.inline-flex.items-center.rounded-full.border');
    const gradientElement = document.querySelector('.bg-gradient-to-r.from-violet-600.to-fuchsia-600');

    // Check transition classes
    expect(toggleContainer).toHaveClass('transition-shadow', 'duration-200');
    expect(gradientElement).toHaveClass('transition-all', 'duration-300', 'ease-in-out');
  });

  // Tests for StructurePlanToggle component
  describe('StructurePlanToggle Component', () => {
    it('renders StructurePlanToggle component correctly', () => {
      render(
        <StructureStats 
          sermon={mockSermon} 
          tagCounts={mockTagCounts} 
          totalThoughts={totalThoughts} 
        />
      );

      // Check if the toggle container exists
      const toggleContainer = document.querySelector('.relative.inline-flex.items-center.rounded-full.border');
      expect(toggleContainer).toBeInTheDocument();
    });

    it('renders both structure and plan buttons', () => {
      render(
        <StructureStats 
          sermon={mockSermon} 
          tagCounts={mockTagCounts} 
          totalThoughts={totalThoughts} 
        />
      );

      expect(screen.getByText('Work on Structure')).toBeInTheDocument();
      expect(screen.getByText('Plan')).toBeInTheDocument();
    });

    it('applies correct button styling classes', () => {
      render(
        <StructureStats 
          sermon={mockSermon} 
          tagCounts={mockTagCounts} 
          totalThoughts={totalThoughts} 
        />
      );

      const structureButton = screen.getByText('Work on Structure');
      const planButton = screen.getByText('Plan');

      // Check common button classes
      expect(structureButton).toHaveClass('relative', 'z-10', 'px-4', 'py-2', 'text-sm', 'font-medium');
      expect(planButton).toHaveClass('relative', 'z-10', 'px-4', 'py-2', 'text-sm', 'font-medium');
    });

    it('applies correct button transitions', () => {
      render(
        <StructureStats 
          sermon={mockSermon} 
          tagCounts={mockTagCounts} 
          totalThoughts={totalThoughts} 
        />
      );

      const structureButton = screen.getByText('Work on Structure');
      const planButton = screen.getByText('Plan');

      // Check transition classes
      expect(structureButton).toHaveClass('transition-all', 'duration-200', 'ease-in-out');
      expect(planButton).toHaveClass('transition-all', 'duration-200', 'ease-in-out');
    });

    it('handles button click events correctly', () => {
      render(
        <StructureStats 
          sermon={mockSermon} 
          tagCounts={mockTagCounts} 
          totalThoughts={totalThoughts} 
        />
      );

      const structureButton = screen.getByText('Work on Structure');
      const planButton = screen.getByText('Plan');

      // Click structure button
      fireEvent.click(structureButton);
      expect(mockPush).toHaveBeenCalledWith(`/sermons/${mockSermon.id}/structure`);

      // Click plan button
      fireEvent.click(planButton);
      expect(mockPush).toHaveBeenCalledWith(`/sermons/${mockSermon.id}/plan`);
    });

    it('prevents structure button click when thoughts have inconsistencies', () => {
      render(
        <StructureStats 
          sermon={mockSermon} 
          tagCounts={mockTagCounts} 
          totalThoughts={totalThoughts} 
          hasInconsistentThoughts={true}
        />
      );

      const structureButton = screen.getByText('Work on Structure');
      
      // Click should not trigger navigation
      fireEvent.click(structureButton);
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('allows plan button click even when thoughts have inconsistencies', () => {
      render(
        <StructureStats 
          sermon={mockSermon} 
          tagCounts={mockTagCounts} 
          totalThoughts={totalThoughts} 
          hasInconsistentThoughts={true}
        />
      );

      const planButton = screen.getByText('Plan');
      
      // Click should still trigger navigation
      fireEvent.click(planButton);
      expect(mockPush).toHaveBeenCalledWith(`/sermons/${mockSermon.id}/plan`);
    });

    it('applies correct disabled state styling to structure button', () => {
      render(
        <StructureStats 
          sermon={mockSermon} 
          tagCounts={mockTagCounts} 
          totalThoughts={totalThoughts} 
          hasInconsistentThoughts={true}
        />
      );

      const structureButton = screen.getByText('Work on Structure');
      
      expect(structureButton).toBeDisabled();
      expect(structureButton).toHaveClass('text-gray-400', 'cursor-not-allowed');
    });

    it('applies correct enabled state styling to structure button', () => {
      render(
        <StructureStats 
          sermon={mockSermon} 
          tagCounts={mockTagCounts} 
          totalThoughts={totalThoughts} 
          hasInconsistentThoughts={false}
        />
      );

      const structureButton = screen.getByText('Work on Structure');
      
      expect(structureButton).not.toBeDisabled();
      expect(structureButton).toHaveClass('text-white');
    });

    it('applies correct hover and active effects to enabled buttons', () => {
      render(
        <StructureStats 
          sermon={mockSermon} 
          tagCounts={mockTagCounts} 
          totalThoughts={totalThoughts} 
          hasInconsistentThoughts={false}
        />
      );

      const structureButton = screen.getByText('Work on Structure');
      const planButton = screen.getByText('Plan');

      // Check hover effects
      expect(structureButton).toHaveClass('hover:scale-105', 'hover:shadow-lg');
      expect(planButton).toHaveClass('hover:scale-105', 'hover:shadow-lg');

      // Check active effects
      expect(structureButton).toHaveClass('active:scale-95');
      expect(planButton).toHaveClass('active:scale-95');
    });

    it('applies correct gradient opacity based on inconsistency state', () => {
      // Test with inconsistencies
      const { rerender } = render(
        <StructureStats 
          sermon={mockSermon} 
          tagCounts={mockTagCounts} 
          totalThoughts={totalThoughts} 
          hasInconsistentThoughts={true}
        />
      );

      let gradientElement = document.querySelector('.bg-gradient-to-r.from-violet-600.to-fuchsia-600');
      expect(gradientElement).toHaveStyle({ opacity: '0.3' });

      // Test without inconsistencies
      rerender(
        <StructureStats 
          sermon={mockSermon} 
          tagCounts={mockTagCounts} 
          totalThoughts={totalThoughts} 
          hasInconsistentThoughts={false}
        />
      );

      gradientElement = document.querySelector('.bg-gradient-to-r.from-violet-600.to-fuchsia-600');
      expect(gradientElement).toHaveStyle({ opacity: '1' });
    });

    it('maintains correct z-index layering for all elements', () => {
      render(
        <StructureStats 
          sermon={mockSermon} 
          tagCounts={mockTagCounts} 
          totalThoughts={totalThoughts} 
        />
      );

      const structureButton = screen.getByText('Work on Structure');
      const planButton = screen.getByText('Plan');
      const separator = document.querySelector('.w-0\\.5.h-6.bg-white\\/90.dark\\:bg-white\\/70');

      // Check z-index values
      expect(structureButton).toHaveClass('relative', 'z-10');
      expect(planButton).toHaveClass('relative', 'z-10');
      expect(separator).toHaveClass('relative', 'z-20');
    });

    it('applies correct responsive design classes', () => {
      render(
        <StructureStats 
          sermon={mockSermon} 
          tagCounts={mockTagCounts} 
          totalThoughts={totalThoughts} 
        />
      );

      const toggleContainer = document.querySelector('.relative.inline-flex.items-center.rounded-full.border');
      
      // Check responsive classes
      expect(toggleContainer).toHaveClass('w-full');
    });

    it('handles dark mode classes correctly', () => {
      render(
        <StructureStats 
          sermon={mockSermon} 
          tagCounts={mockTagCounts} 
          totalThoughts={totalThoughts} 
        />
      );

      const toggleContainer = document.querySelector('.relative.inline-flex.items-center.rounded-full.border');
      const gradientElement = document.querySelector('.bg-gradient-to-r.from-violet-600.to-fuchsia-600');
      const separator = document.querySelector('.w-0\\.5.h-6.bg-white\\/90.dark\\:bg-white\\/70');

      // Check dark mode classes
      expect(toggleContainer).toHaveClass('dark:border-gray-700', 'dark:bg-gray-800');
      expect(gradientElement).toHaveClass('dark:from-violet-500', 'dark:to-fuchsia-500');
      expect(separator).toHaveClass('dark:bg-white/70');
    });

    it('maintains accessibility attributes', () => {
      render(
        <StructureStats 
          sermon={mockSermon} 
          tagCounts={mockTagCounts} 
          totalThoughts={totalThoughts} 
          hasInconsistentThoughts={true}
        />
      );

      const structureButton = screen.getByText('Work on Structure');
      const planButton = screen.getByText('Plan');

      // Check button types
      expect(structureButton).toHaveAttribute('type', 'button');
      expect(planButton).toHaveAttribute('type', 'button');

      // Check titles
      expect(structureButton).toHaveAttribute('title', 'Some thoughts have tag inconsistencies. Please fix them before working on structure.');
      expect(planButton).not.toHaveAttribute('title');
    });
  });
}); 
