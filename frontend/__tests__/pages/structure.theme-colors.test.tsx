import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import StructurePage from '../../app/(pages)/(private)/structure/page';

// Mock the theme colors utility
jest.mock('@/utils/themeColors', () => ({
  getFocusModeButtonColors: jest.fn((section: string) => {
    const colorMap = {
      introduction: { bg: 'bg-amber-500', text: 'text-white' },
      mainPart: { bg: 'bg-blue-500', text: 'text-white' },
      conclusion: { bg: 'bg-green-500', text: 'text-white' }
    };
    return colorMap[section as keyof typeof colorMap] || { bg: 'bg-gray-500', text: 'text-white' };
  })
}));

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useSearchParams: jest.fn(),
  useRouter: jest.fn(() => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    refresh: jest.fn(),
    prefetch: jest.fn(),
  })),
  usePathname: jest.fn(() => '/structure'),
}));

// Mock the useSermonStructureData hook
jest.mock('@/hooks/useSermonStructureData', () => ({
  useSermonStructureData: jest.fn(() => ({
    sermon: { id: 'test123', title: 'Test Sermon' },
    setSermon: jest.fn(),
    containers: {
      introduction: [],
      main: [],
      conclusion: [],
      ambiguous: []
    },
    setContainers: jest.fn(),
    outlinePoints: {
      introduction: [],
      main: [],
      conclusion: []
    },
    requiredTagColors: {
      introduction: '#d97706',
      main: '#2563eb',
      conclusion: '#16a34a'
    },
    allowedTags: [],
    loading: false,
    error: null,
    setLoading: jest.fn(),
    isAmbiguousVisible: false,
    setIsAmbiguousVisible: jest.fn()
  }))
}));

// Mock the useTranslation hook
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'structure.introduction': 'Introduction',
        'structure.mainPart': 'Main Part',
        'structure.conclusion': 'Conclusion',
        'structure.focusMode': 'Focus Mode',
        'structure.noEntries': 'No entries'
      };
      return translations[key] || key;
    }
  })
}));

// Mock the Column component
jest.mock('@/components/Column', () => {
  return function MockColumn({ id, title }: { id: string; title: string }) {
    return (
      <div data-testid={`column-${id}`}>
        <h3>{title}</h3>
      </div>
    );
  };
});

// Mock the SortableItem component
jest.mock('@/components/SortableItem', () => {
  return function MockSortableItem({ item }: { item: any }) {
    return (
      <div data-testid={`item-${item.id}`}>
        {item.content}
      </div>
    );
  };
});

describe('Structure Page Theme Colors', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Focus Mode Navigation Button Colors', () => {
    it('should render navigation buttons with correct theme colors for introduction section', async () => {
      const mockSearchParams = new URLSearchParams('?mode=focus&section=introduction&sermonId=test123');
      jest.spyOn(require('next/navigation'), 'useSearchParams').mockReturnValue(mockSearchParams);
      
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Check that all three navigation buttons are present
      const navigationButtons = screen.getAllByRole('button').filter(button => 
        ['Introduction', 'Main Part', 'Conclusion'].includes(button.textContent || '')
      );
      expect(navigationButtons).toHaveLength(3);
      
      // Introduction button should be active with amber colors
      const introductionButton = navigationButtons.find(button => button.textContent === 'Introduction');
      expect(introductionButton).toBeInTheDocument();
      expect(introductionButton).toHaveClass('bg-amber-500');
      expect(introductionButton).toHaveClass('text-white');
      
      // Other buttons should be inactive with gray colors
      const mainPartButton = navigationButtons.find(button => button.textContent === 'Main Part');
      const conclusionButton = navigationButtons.find(button => button.textContent === 'Conclusion');
      
      expect(mainPartButton).toHaveClass('bg-gray-100');
      expect(mainPartButton).toHaveClass('text-gray-700');
      expect(conclusionButton).toHaveClass('bg-gray-100');
      expect(conclusionButton).toHaveClass('text-gray-700');
    });

    it('should render navigation buttons with correct theme colors for main section', async () => {
      const mockSearchParams = new URLSearchParams('?mode=focus&section=main&sermonId=test123');
      jest.spyOn(require('next/navigation'), 'useSearchParams').mockReturnValue(mockSearchParams);
      
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Main part button should be active with blue colors
      const navigationButtons = screen.getAllByRole('button').filter(button => 
        ['Introduction', 'Main Part', 'Conclusion'].includes(button.textContent || '')
      );
      const mainPartButton = navigationButtons.find(button => button.textContent === 'Main Part');
      expect(mainPartButton).toBeInTheDocument();
      expect(mainPartButton).toHaveClass('bg-blue-500');
      expect(mainPartButton).toHaveClass('text-white');
      
      // Other buttons should be inactive with gray colors
      const introductionButton = navigationButtons.find(button => button.textContent === 'Introduction');
      const conclusionButton = navigationButtons.find(button => button.textContent === 'Conclusion');
      
      expect(introductionButton).toHaveClass('bg-gray-100');
      expect(introductionButton).toHaveClass('text-gray-700');
      expect(conclusionButton).toHaveClass('bg-gray-100');
      expect(conclusionButton).toHaveClass('text-gray-700');
    });

    it('should render navigation buttons with correct theme colors for conclusion section', async () => {
      const mockSearchParams = new URLSearchParams('?mode=focus&section=conclusion&sermonId=test123');
      jest.spyOn(require('next/navigation'), 'useSearchParams').mockReturnValue(mockSearchParams);
      
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Conclusion button should be active with green colors
      const navigationButtons = screen.getAllByRole('button').filter(button => 
        ['Introduction', 'Main Part', 'Conclusion'].includes(button.textContent || '')
      );
      const conclusionButton = navigationButtons.find(button => button.textContent === 'Conclusion');
      expect(conclusionButton).toBeInTheDocument();
      expect(conclusionButton).toHaveClass('bg-green-500');
      expect(conclusionButton).toHaveClass('text-white');
      
      // Other buttons should be inactive with gray colors
      const introductionButton = navigationButtons.find(button => button.textContent === 'Introduction');
      const mainPartButton = navigationButtons.find(button => button.textContent === 'Main Part');
      
      expect(introductionButton).toHaveClass('bg-gray-100');
      expect(introductionButton).toHaveClass('text-gray-700');
      expect(mainPartButton).toHaveClass('bg-gray-100');
      expect(mainPartButton).toHaveClass('text-gray-700');
    });

    it('should apply consistent base styling to all navigation buttons', async () => {
      const mockSearchParams = new URLSearchParams('?mode=focus&section=introduction&sermonId=test123');
      jest.spyOn(require('next/navigation'), 'useSearchParams').mockReturnValue(mockSearchParams);
      
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Get all navigation buttons
      const navigationButtons = screen.getAllByRole('button').filter(button => 
        ['Introduction', 'Main Part', 'Conclusion'].includes(button.textContent || '')
      );
      
      expect(navigationButtons).toHaveLength(3);
      
      // All buttons should have the same base styling
      navigationButtons.forEach(button => {
        expect(button).toHaveClass('px-3');
        expect(button).toHaveClass('py-1.5');
        expect(button).toHaveClass('rounded-md');
        expect(button).toHaveClass('text-sm');
        expect(button).toHaveClass('font-medium');
        expect(button).toHaveClass('transition-colors');
        expect(button).toHaveClass('duration-200');
      });
    });

    it('should handle dark mode styling for inactive buttons', async () => {
      const mockSearchParams = new URLSearchParams('?mode=focus&section=introduction&sermonId=test123');
      jest.spyOn(require('next/navigation'), 'useSearchParams').mockReturnValue(mockSearchParams);
      
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Get inactive buttons
      const navigationButtons = screen.getAllByRole('button').filter(button => 
        ['Introduction', 'Main Part', 'Conclusion'].includes(button.textContent || '')
      );
      const mainPartButton = navigationButtons.find(button => button.textContent === 'Main Part');
      const conclusionButton = navigationButtons.find(button => button.textContent === 'Conclusion');
      
      // Check dark mode classes are present
      expect(mainPartButton).toHaveClass('dark:bg-gray-700');
      expect(mainPartButton).toHaveClass('dark:hover:bg-gray-600');
      expect(mainPartButton).toHaveClass('dark:text-gray-300');
      
      expect(conclusionButton).toHaveClass('dark:bg-gray-700');
      expect(conclusionButton).toHaveClass('dark:hover:bg-gray-600');
      expect(conclusionButton).toHaveClass('dark:text-gray-300');
    });

    it('should maintain button accessibility attributes', async () => {
      const mockSearchParams = new URLSearchParams('?mode=focus&section=introduction&sermonId=test123');
      jest.spyOn(require('next/navigation'), 'useSearchParams').mockReturnValue(mockSearchParams);
      
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Get all navigation buttons
      const navigationButtons = screen.getAllByRole('button').filter(button => 
        ['Introduction', 'Main Part', 'Conclusion'].includes(button.textContent || '')
      );
      
      // All buttons should be accessible
      navigationButtons.forEach(button => {
        expect(button).toBeInTheDocument();
        expect(button).toHaveRole('button');
      });
    });
  });

  describe('Theme Color Integration', () => {
    it('should call getFocusModeButtonColors with correct section parameters', async () => {
      const mockSearchParams = new URLSearchParams('?mode=focus&section=introduction&sermonId=test123');
      jest.spyOn(require('next/navigation'), 'useSearchParams').mockReturnValue(mockSearchParams);
      
      const { getFocusModeButtonColors } = require('@/utils/themeColors');
      
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Verify that getFocusModeButtonColors was called with correct parameters
      expect(getFocusModeButtonColors).toHaveBeenCalledWith('introduction');
      expect(getFocusModeButtonColors).toHaveBeenCalledWith('mainPart');
      expect(getFocusModeButtonColors).toHaveBeenCalledWith('conclusion');
      
      // Verify it was called exactly 3 times (once for each section)
      expect(getFocusModeButtonColors).toHaveBeenCalledTimes(3);
    });

    it('should handle theme color function errors gracefully', async () => {
      // Mock the theme colors utility to throw an error
      jest.doMock('@/utils/themeColors', () => ({
        getFocusModeButtonColors: jest.fn(() => {
          throw new Error('Theme color error');
        })
      }));
      
      const mockSearchParams = new URLSearchParams('?mode=focus&section=introduction&sermonId=test123');
      jest.spyOn(require('next/navigation'), 'useSearchParams').mockReturnValue(mockSearchParams);
      
      // Component should still render without crashing
      expect(() => render(<StructurePage />)).not.toThrow();
    });
  });
});
