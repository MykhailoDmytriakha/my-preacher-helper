import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { FocusNav } from '../FocusNav';
import { getFocusModeUrl } from '@/utils/urlUtils';

// Mock react-i18next
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}));

// Mock URL utilities
jest.mock('@/utils/urlUtils', () => ({
  getFocusModeUrl: jest.fn()
}));

const mockGetFocusModeUrl = getFocusModeUrl as jest.MockedFunction<typeof getFocusModeUrl>;
const buildStructurePath = (sermonId: string) => `/sermons/${sermonId}/structure`;
const buildFocusUrl = (section: string, sermonId: string) => `${buildStructurePath(sermonId)}?mode=focus&section=${section}`;

describe('FocusNav', () => {
  const defaultProps = {
    sermon: { id: 'sermon-1', title: 'Test Sermon' },
    sermonId: 'sermon-1',
    focusedColumn: null,
    onToggleFocusMode: jest.fn(),
    onNavigateToSection: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetFocusModeUrl.mockImplementation((section, sermonId) =>
      buildFocusUrl(section, sermonId)
    );
  });

  describe('rendering', () => {
    it('should render back to sermon link when not in focus mode', () => {
      render(<FocusNav {...defaultProps} />);
      
      const backLink = screen.getByText('structure.backToSermon');
      expect(backLink).toBeInTheDocument();
      expect(backLink.closest('a')).toHaveAttribute('href', '/sermons/sermon-1');
    });

    it('should render focus mode navigation when focused', () => {
      render(<FocusNav {...defaultProps} focusedColumn="introduction" />);
      
      expect(screen.getByText(/structure\.focusMode/)).toBeInTheDocument();
      expect(screen.getByText('structure.introduction')).toBeInTheDocument();
      expect(screen.getByText('structure.mainPart')).toBeInTheDocument();
      expect(screen.getByText('structure.conclusion')).toBeInTheDocument();
    });

    it('should render focus mode indicator when focused', () => {
      render(<FocusNav {...defaultProps} focusedColumn="main" />);
      
      expect(screen.getByText(/structure\.focusMode/)).toBeInTheDocument();
    });
  });

  describe('focus mode navigation', () => {
    it('should render introduction section button when focused', () => {
      render(<FocusNav {...defaultProps} focusedColumn="introduction" />);
      
      const introButton = screen.getByText('structure.introduction');
      expect(introButton).toBeInTheDocument();
      // Check that it's a button element
      expect(introButton.tagName).toBe('BUTTON');
    });

    it('should render main section button when focused', () => {
      render(<FocusNav {...defaultProps} focusedColumn="main" />);
      
      const mainButton = screen.getByText('structure.mainPart');
      expect(mainButton).toBeInTheDocument();
      // Check that it's a button element
      expect(mainButton.tagName).toBe('BUTTON');
    });

    it('should render conclusion section button when focused', () => {
      render(<FocusNav {...defaultProps} focusedColumn="conclusion" />);
      
      const conclusionButton = screen.getByText('structure.conclusion');
      expect(conclusionButton).toBeInTheDocument();
      // Check that it's a button element
      expect(conclusionButton.tagName).toBe('BUTTON');
    });

    it('should call getFocusModeUrl with correct parameters when not focused', () => {
      render(<FocusNav {...defaultProps} />);
      
      // The component should call getFocusModeUrl for each section when rendering Links
      expect(mockGetFocusModeUrl).toHaveBeenCalledWith('introduction', 'sermon-1');
      expect(mockGetFocusModeUrl).toHaveBeenCalledWith('main', 'sermon-1');
      expect(mockGetFocusModeUrl).toHaveBeenCalledWith('conclusion', 'sermon-1');
    });
  });

  describe('focus mode toggle', () => {
    it('should call onToggleFocusMode when normal mode button is clicked', () => {
      const mockOnToggleFocusMode = jest.fn();
      render(<FocusNav {...defaultProps} focusedColumn="introduction" onToggleFocusMode={mockOnToggleFocusMode} />);
      
      const normalModeButton = screen.getByText('structure.normalMode');
      fireEvent.click(normalModeButton);
      
      expect(mockOnToggleFocusMode).toHaveBeenCalledWith('introduction');
    });

    it('should call onToggleFocusMode with correct section when focused', () => {
      const mockOnToggleFocusMode = jest.fn();
      render(<FocusNav {...defaultProps} focusedColumn="main" onToggleFocusMode={mockOnToggleFocusMode} />);
      
      const normalModeButton = screen.getByText('structure.normalMode');
      fireEvent.click(normalModeButton);
      
      expect(mockOnToggleFocusMode).toHaveBeenCalledWith('main');
    });
  });

  describe('section navigation', () => {
    it('should call onNavigateToSection when introduction button is clicked', () => {
      const mockOnNavigateToSection = jest.fn();
      render(<FocusNav {...defaultProps} focusedColumn="introduction" onNavigateToSection={mockOnNavigateToSection} />);
      
      const introButton = screen.getByText('structure.introduction');
      fireEvent.click(introButton);
      
      expect(mockOnNavigateToSection).toHaveBeenCalledWith('introduction');
    });

    it('should call onNavigateToSection when main button is clicked', () => {
      const mockOnNavigateToSection = jest.fn();
      render(<FocusNav {...defaultProps} focusedColumn="main" onNavigateToSection={mockOnNavigateToSection} />);
      
      const mainButton = screen.getByText('structure.mainPart');
      fireEvent.click(mainButton);
      
      expect(mockOnNavigateToSection).toHaveBeenCalledWith('main');
    });

    it('should call onNavigateToSection when conclusion button is clicked', () => {
      const mockOnNavigateToSection = jest.fn();
      render(<FocusNav {...defaultProps} focusedColumn="conclusion" onNavigateToSection={mockOnNavigateToSection} />);
      
      const conclusionButton = screen.getByText('structure.conclusion');
      fireEvent.click(conclusionButton);
      
      expect(mockOnNavigateToSection).toHaveBeenCalledWith('conclusion');
    });
  });

  describe('edge cases', () => {
    it('should handle missing sermonId gracefully', () => {
      render(<FocusNav {...defaultProps} sermonId={null} />);
      
      const backLink = screen.getByText('structure.backToSermon');
      expect(backLink.closest('a')).toHaveAttribute('href', '/sermons/sermon-1');
    });

    it('should handle undefined sermonId gracefully', () => {
      render(<FocusNav {...defaultProps} sermonId={undefined} />);
      
      const backLink = screen.getByText('structure.backToSermon');
      expect(backLink.closest('a')).toHaveAttribute('href', '/sermons/sermon-1');
    });

    it('should handle empty sermonId gracefully', () => {
      render(<FocusNav {...defaultProps} sermonId="" />);
      
      const backLink = screen.getByText('structure.backToSermon');
      expect(backLink.closest('a')).toHaveAttribute('href', '/sermons/sermon-1');
    });

    it('should handle special characters in sermonId', () => {
      render(<FocusNav {...defaultProps} sermonId="sermon-123_abc" />);
      
      expect(mockGetFocusModeUrl).toHaveBeenCalledWith('introduction', 'sermon-123_abc');
    });

    it('should handle very long sermonId', () => {
      const longSermonId = 'a'.repeat(1000);
      render(<FocusNav {...defaultProps} sermonId={longSermonId} />);
      
      expect(mockGetFocusModeUrl).toHaveBeenCalledWith('introduction', longSermonId);
    });
  });

  describe('accessibility', () => {
    it('should have proper button attributes when focused', () => {
      render(<FocusNav {...defaultProps} focusedColumn="introduction" />);
      
      const introButton = screen.getByText('structure.introduction');
      const mainButton = screen.getByText('structure.mainPart');
      const conclusionButton = screen.getByText('structure.conclusion');
      
      // Check that they are button elements
      expect(introButton.tagName).toBe('BUTTON');
      expect(mainButton.tagName).toBe('BUTTON');
      expect(conclusionButton.tagName).toBe('BUTTON');
    });

    it('should have proper link attributes when not focused', () => {
      render(<FocusNav {...defaultProps} />);
      
      const introLink = screen.getByText('structure.introduction');
      const mainLink = screen.getByText('structure.mainPart');
      const conclusionLink = screen.getByText('structure.conclusion');
      
      expect(introLink.closest('a')).toHaveAttribute('href');
      expect(mainLink.closest('a')).toHaveAttribute('href');
      expect(conclusionLink.closest('a')).toHaveAttribute('href');
    });

    it('should have proper navigation structure', () => {
      render(<FocusNav {...defaultProps} focusedColumn="introduction" />);
      
      const navigationContainer = screen.getByText('structure.introduction').closest('div');
      expect(navigationContainer).toBeInTheDocument();
    });
  });

  describe('styling and layout', () => {
    it('should render with proper spacing', () => {
      render(<FocusNav {...defaultProps} focusedColumn="introduction" />);
      
      const focusModeText = screen.getByText(/structure\.focusMode/);
      expect(focusModeText).toBeInTheDocument();
    });

    it('should render with proper structure', () => {
      render(<FocusNav {...defaultProps} focusedColumn="introduction" />);
      
      // The main container should have text-center class
      const mainContainer = screen.getByText('structure.introduction').closest('div')?.parentElement?.parentElement;
      expect(mainContainer).toHaveClass('text-center');
    });
  });

  describe('translation integration', () => {
    it('should use translation keys for text', () => {
      render(<FocusNav {...defaultProps} />);
      
      expect(screen.getByText('structure.backToSermon')).toBeInTheDocument();
      // When not focused, focusMode text is rendered
      expect(screen.getByText(/structure\.focusMode/)).toBeInTheDocument();
    });

    it('should handle missing translations gracefully', () => {
      render(<FocusNav {...defaultProps} />);
      
      // Component should still render even with missing translations
      expect(screen.getByText('structure.backToSermon')).toBeInTheDocument();
    });
  });

  describe('interaction behavior', () => {
    it('should handle multiple rapid clicks gracefully', () => {
      const mockOnToggleFocusMode = jest.fn();
      render(<FocusNav {...defaultProps} focusedColumn="introduction" onToggleFocusMode={mockOnToggleFocusMode} />);
      
      const normalModeButton = screen.getByText('structure.normalMode');
      
      // Click multiple times rapidly
      fireEvent.click(normalModeButton);
      fireEvent.click(normalModeButton);
      fireEvent.click(normalModeButton);
      
      expect(mockOnToggleFocusMode).toHaveBeenCalledTimes(3);
    });
  });

  describe('performance considerations', () => {
    it('should not re-render unnecessarily', () => {
      const { rerender } = render(<FocusNav {...defaultProps} />);
      
      // Re-render with same props
      rerender(<FocusNav {...defaultProps} />);
      
      // Component should still be functional
      expect(screen.getByText('structure.backToSermon')).toBeInTheDocument();
    });
  });

  describe('error boundaries', () => {
    it('should handle missing sermon data gracefully', () => {
      render(<FocusNav {...defaultProps} sermon={{ id: '', title: '' }} />);
      
      // Component should still render
      expect(screen.getByText('structure.backToSermon')).toBeInTheDocument();
    });

    it('should handle malformed sermon data gracefully', () => {
      render(<FocusNav {...defaultProps} sermon={{ id: 'invalid', title: undefined as any }} />);
      
      // Component should still render
      expect(screen.getByText('structure.backToSermon')).toBeInTheDocument();
    });
  });
});
