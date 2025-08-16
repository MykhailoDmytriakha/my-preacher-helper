import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '@/components/ui/Button';

describe('Button Component', () => {
  const defaultProps = {
    children: 'Test Button',
  };

  describe('Rendering', () => {
    it('renders with default variant and styles', () => {
      render(<Button {...defaultProps} />);
      
      const button = screen.getByRole('button', { name: 'Test Button' });
      expect(button).toBeInTheDocument();
      expect(button).toHaveClass('px-4', 'py-2', 'text-sm', 'font-medium', 'rounded-md', 'transition-colors');
      expect(button).toHaveClass('bg-gray-200', 'hover:bg-gray-300', 'text-gray-700');
    });

    it('renders with primary variant', () => {
      render(<Button {...defaultProps} variant="primary" />);
      
      const button = screen.getByRole('button', { name: 'Test Button' });
      expect(button).toHaveClass('bg-blue-500', 'hover:bg-blue-600', 'text-white');
    });

    it('renders with secondary variant', () => {
      render(<Button {...defaultProps} variant="secondary" />);
      
      const button = screen.getByRole('button', { name: 'Test Button' });
      expect(button).toHaveClass('bg-gray-500', 'hover:bg-gray-600', 'text-white');
    });

    it('renders with section variant and custom colors', () => {
      const sectionColor = {
        base: '#3B82F6',
        light: '#93C5FD',
        dark: '#1E40AF',
      };

      render(<Button {...defaultProps} variant="section" sectionColor={sectionColor} />);
      
      const button = screen.getByRole('button', { name: 'Test Button' });
      expect(button).toHaveClass('section-button');
      expect(button).toHaveStyle({
        backgroundColor: '#3B82F6',
        '--hover-bg': '#1E40AF',
        '--active-bg': '#3B82F6',
        borderColor: '#1E40AF',
      });
    });

    it('renders with section variant but falls back to primary when no sectionColor provided', () => {
      render(<Button {...defaultProps} variant="section" />);
      
      const button = screen.getByRole('button', { name: 'Test Button' });
      expect(button).toHaveClass('bg-blue-500', 'hover:bg-blue-600', 'text-white');
    });
  });

  describe('Props and Behavior', () => {
    it('calls onClick when clicked', () => {
      const handleClick = jest.fn();
      render(<Button {...defaultProps} onClick={handleClick} />);
      
      const button = screen.getByRole('button', { name: 'Test Button' });
      fireEvent.click(button);
      
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('does not call onClick when disabled', () => {
      const handleClick = jest.fn();
      render(<Button {...defaultProps} onClick={handleClick} disabled />);
      
      const button = screen.getByRole('button', { name: 'Test Button' });
      fireEvent.click(button);
      
      expect(handleClick).not.toHaveBeenCalled();
    });

    it('applies custom className', () => {
      const customClass = 'custom-button-class';
      render(<Button {...defaultProps} className={customClass} />);
      
      const button = screen.getByRole('button', { name: 'Test Button' });
      expect(button).toHaveClass(customClass);
    });

    it('applies title attribute', () => {
      const title = 'Button tooltip';
      render(<Button {...defaultProps} title={title} />);
      
      const button = screen.getByRole('button', { name: 'Test Button' });
      expect(button).toHaveAttribute('title', title);
    });

    it('renders children correctly', () => {
      const customChildren = <span data-testid="custom-content">Custom Content</span>;
      render(<Button>{customChildren}</Button>);
      
      expect(screen.getByTestId('custom-content')).toBeInTheDocument();
      expect(screen.getByText('Custom Content')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('has correct button role', () => {
      render(<Button {...defaultProps} />);
      
      const button = screen.getByRole('button');
      expect(button).toBeInTheDocument();
    });

    it('is disabled when disabled prop is true', () => {
      render(<Button {...defaultProps} disabled />);
      
      const button = screen.getByRole('button', { name: 'Test Button' });
      expect(button).toBeDisabled();
    });

    it('is not disabled when disabled prop is false', () => {
      render(<Button {...defaultProps} disabled={false} />);
      
      const button = screen.getByRole('button', { name: 'Test Button' });
      expect(button).not.toBeDisabled();
    });

    it('is not disabled when disabled prop is undefined', () => {
      render(<Button {...defaultProps} />);
      
      const button = screen.getByRole('button', { name: 'Test Button' });
      expect(button).not.toBeDisabled();
    });
  });

  describe('CSS Variables and Styling', () => {
    it('sets CSS custom properties for section variant', () => {
      const sectionColor = {
        base: '#10B981',
        light: '#6EE7B7',
        dark: '#047857',
      };

      render(<Button {...defaultProps} variant="section" sectionColor={sectionColor} />);
      
      const button = screen.getByRole('button', { name: 'Test Button' });
      expect(button).toHaveStyle({
        '--hover-bg': '#047857',
        '--active-bg': '#10B981',
      });
    });

    it('applies base styles to all variants', () => {
      const variants = ['default', 'primary', 'secondary', 'section'] as const;
      
      variants.forEach(variant => {
        const { unmount } = render(
          <Button 
            {...defaultProps} 
            variant={variant} 
            sectionColor={variant === 'section' ? { base: '#000', light: '#333', dark: '#666' } : undefined}
          />
        );
        
        const button = screen.getByRole('button', { name: 'Test Button' });
        expect(button).toHaveClass('px-4', 'py-2', 'text-sm', 'font-medium', 'rounded-md', 'transition-colors');
        
        unmount();
      });
    });
  });

  describe('Edge Cases', () => {
    it('handles empty children', () => {
      render(<Button children="" />);
      
      const button = screen.getByRole('button');
      expect(button).toBeInTheDocument();
      expect(button).toHaveTextContent('');
    });

    it('handles null onClick', () => {
      render(<Button {...defaultProps} onClick={undefined} />);
      
      const button = screen.getByRole('button', { name: 'Test Button' });
      expect(() => fireEvent.click(button)).not.toThrow();
    });

    it('handles empty className', () => {
      render(<Button {...defaultProps} className="" />);
      
      const button = screen.getByRole('button', { name: 'Test Button' });
      expect(button).toBeInTheDocument();
    });

    it('handles undefined className', () => {
      render(<Button {...defaultProps} className={undefined} />);
      
      const button = screen.getByRole('button', { name: 'Test Button' });
      expect(button).toBeInTheDocument();
    });
  });

  describe('Integration', () => {
    it('combines multiple props correctly', () => {
      const handleClick = jest.fn();
      const customClass = 'integration-test-class';
      const title = 'Integration test button';
      
      render(
        <Button 
          variant="primary"
          onClick={handleClick}
          className={customClass}
          title={title}
          disabled={false}
          children="Integration Button"
        />
      );
      
      const button = screen.getByRole('button', { name: 'Integration Button' });
      
      // Check all props are applied
      expect(button).toHaveClass('bg-blue-500', 'hover:bg-blue-600', 'text-white');
      expect(button).toHaveClass(customClass);
      expect(button).toHaveAttribute('title', title);
      expect(button).not.toBeDisabled();
      
      // Test click functionality
      fireEvent.click(button);
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('renders different variants with same children', () => {
      const variants = ['default', 'primary', 'secondary'] as const;
      
      variants.forEach((variant, index) => {
        const { unmount } = render(
          <Button key={index} variant={variant}>
            Same Content
          </Button>
        );
        
        const button = screen.getByRole('button', { name: 'Same Content' });
        expect(button).toHaveTextContent('Same Content');
        
        unmount();
      });
    });
  });
});
