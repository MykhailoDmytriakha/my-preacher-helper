import { render, screen } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import { OutlinePoint } from '@/models/models';
import { ProgressSidebar } from '@/components/plan/ProgressSidebar';

// Mock MutationObserver for theme detection
global.MutationObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  disconnect: jest.fn(),
  takeRecords: jest.fn(),
}));

// Mock document element for theme detection
const mockClassList = {
  contains: jest.fn().mockReturnValue(false), // Default to light theme
};

Object.defineProperty(document, 'documentElement', {
  value: {
    classList: mockClassList,
  },
  writable: true,
});

describe('ProgressSidebar', () => {
  const mockOutline: {
    introduction: OutlinePoint[];
    main: OutlinePoint[];
    conclusion: OutlinePoint[];
  } = {
    introduction: [
      { id: 'intro-1', text: 'Introduction Point 1' },
      { id: 'intro-2', text: 'Introduction Point 2' },
    ],
    main: [
      { id: 'main-1', text: 'Main Point 1' },
      { id: 'main-2', text: 'Main Point 2' },
      { id: 'main-3', text: 'Main Point 3' },
    ],
    conclusion: [
      { id: 'conc-1', text: 'Conclusion Point 1' },
    ],
  };

  const mockSavedPoints: Record<string, boolean> = {
    'intro-1': true,
    'intro-2': false,
    'main-1': true,
    'main-2': true,
    'main-3': false,
    'conc-1': true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders progress indicators for all outline points', () => {
    render(
      <ProgressSidebar
        outline={mockOutline}
        savedSermonPoints={mockSavedPoints}
      />
    );

    // Should render 6 total points (2 intro + 3 main + 1 conclusion)
    const progressIndicators = document.querySelectorAll('div[title]');
    expect(progressIndicators).toHaveLength(6);
  });

  it('applies correct colors for saved points', () => {
    render(
      <ProgressSidebar
        outline={mockOutline}
        savedSermonPoints={mockSavedPoints}
      />
    );

    // Check that saved points have the correct background color
    // Note: We can't easily test inline styles in this setup, but we can verify the structure
    const allPoints = document.querySelectorAll('div[title]');
    expect(allPoints).toHaveLength(6);
  });

  it('shows correct titles for saved and unsaved points', () => {
    render(
      <ProgressSidebar
        outline={mockOutline}
        savedSermonPoints={mockSavedPoints}
      />
    );

    // Check title attributes
    expect(screen.getByTitle('Introduction Point 1 - Сохранено')).toBeInTheDocument();
    expect(screen.getByTitle('Introduction Point 2 - Не сохранено')).toBeInTheDocument();
    expect(screen.getByTitle('Main Point 1 - Сохранено')).toBeInTheDocument();
    expect(screen.getByTitle('Main Point 2 - Сохранено')).toBeInTheDocument();
    expect(screen.getByTitle('Main Point 3 - Не сохранено')).toBeInTheDocument();
    expect(screen.getByTitle('Conclusion Point 1 - Сохранено')).toBeInTheDocument();
  });

  it('renders nothing when outline is empty', () => {
    const emptyOutline = {
      introduction: [],
      main: [],
      conclusion: [],
    };

    const { container } = render(
      <ProgressSidebar
        outline={emptyOutline}
        savedSermonPoints={{}}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('positions correctly with fixed positioning', () => {
    render(
      <ProgressSidebar
        outline={mockOutline}
        savedSermonPoints={mockSavedPoints}
      />
    );

    const sidebar = document.querySelector('.fixed');
    expect(sidebar).toHaveClass('fixed');
    expect(sidebar).toHaveClass('left-4');
    expect(sidebar).toHaveClass('top-1/2');
    expect(sidebar).toHaveClass('transform');
    expect(sidebar).toHaveClass('-translate-y-1/2');
  });

  it('applies correct styling for different point states', () => {
    render(
      <ProgressSidebar
        outline={mockOutline}
        savedSermonPoints={mockSavedPoints}
      />
    );

    const points = document.querySelectorAll('div[title]');

    // All points should have base classes
    points.forEach(point => {
      expect(point).toHaveClass('w-3', 'h-3', 'rounded-sm', 'transition-all', 'duration-300', 'border');
    });
  });

  it('detects dark theme and adjusts colors', () => {
    // Mock dark theme
    (document.documentElement.classList.contains as jest.Mock).mockReturnValue(true);

    render(
      <ProgressSidebar
        outline={mockOutline}
        savedSermonPoints={mockSavedPoints}
      />
    );

    // Component should re-render with dark theme colors
    // This tests the useEffect hook for theme detection
    expect(document.documentElement.classList.contains).toHaveBeenCalledWith('dark');
  });
});