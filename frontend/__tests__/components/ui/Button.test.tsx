import React from 'react';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { Button } from '@/components/ui/Button';
import { runScenarios } from '@test-utils/scenarioRunner';

describe('Button Component', () => {
  const defaultProps = {
    children: 'Test Button',
  };

  describe('Rendering', () => {
    it('covers variant rendering scenarios', async () => {
      const sectionColor = { base: '#3B82F6', light: '#93C5FD', dark: '#1E40AF' };

      await runScenarios(
        [
          {
            name: 'default variant styles',
            run: () => {
              render(<Button {...defaultProps} />);
              const button = screen.getByRole('button', { name: 'Test Button' });
              expect(button).toHaveClass('bg-gray-200', 'hover:bg-gray-300', 'text-gray-700');
            }
          },
          {
            name: 'primary variant classes',
            run: () => {
              render(<Button {...defaultProps} variant="primary" />);
              expect(screen.getByRole('button', { name: 'Test Button' })).toHaveClass('bg-blue-500', 'hover:bg-blue-600');
            }
          },
          {
            name: 'secondary variant classes',
            run: () => {
              render(<Button {...defaultProps} variant="secondary" />);
              expect(screen.getByRole('button', { name: 'Test Button' })).toHaveClass('bg-gray-500');
            }
          },
          {
            name: 'section variant uses custom colors',
            run: () => {
              render(<Button {...defaultProps} variant="section" sectionColor={sectionColor} />);
              expect(screen.getByRole('button', { name: 'Test Button' })).toHaveStyle({ backgroundColor: '#3B82F6' });
            }
          },
          {
            name: 'section variant falls back when color missing',
            run: () => {
              render(<Button {...defaultProps} variant="section" />);
              expect(screen.getByRole('button', { name: 'Test Button' })).toHaveClass('bg-blue-500');
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  describe('Props and Behavior', () => {
    it('handles props consistently', async () => {
      await runScenarios(
        [
          {
            name: 'fires onClick when enabled',
            run: () => {
              const handleClick = jest.fn();
              render(<Button {...defaultProps} onClick={handleClick} />);
              fireEvent.click(screen.getByRole('button', { name: 'Test Button' }));
              expect(handleClick).toHaveBeenCalledTimes(1);
            }
          },
          {
            name: 'prevents click when disabled',
            run: () => {
              const handleClick = jest.fn();
              render(<Button {...defaultProps} onClick={handleClick} disabled />);
              fireEvent.click(screen.getByRole('button', { name: 'Test Button' }));
              expect(handleClick).not.toHaveBeenCalled();
            }
          },
          {
            name: 'accepts custom class and title',
            run: () => {
              render(<Button {...defaultProps} className="custom-button-class" title="Button tooltip" />);
              const button = screen.getByRole('button', { name: 'Test Button' });
              expect(button).toHaveClass('custom-button-class');
              expect(button).toHaveAttribute('title', 'Button tooltip');
            }
          },
          {
            name: 'renders arbitrary children',
            run: () => {
              const child = <span data-testid="custom-content">Custom Content</span>;
              render(<Button>{child}</Button>);
              expect(screen.getByTestId('custom-content')).toBeInTheDocument();
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  describe('Accessibility', () => {
    it('ensures role and disabled handling', async () => {
      await runScenarios(
        [
          {
            name: 'button role exists',
            run: () => {
              render(<Button {...defaultProps} />);
              expect(screen.getByRole('button')).toBeInTheDocument();
            }
          },
          {
            name: 'disabled prop true',
            run: () => {
              render(<Button {...defaultProps} disabled />);
              expect(screen.getByRole('button', { name: 'Test Button' })).toBeDisabled();
            }
          },
          {
            name: 'disabled false',
            run: () => {
              render(<Button {...defaultProps} disabled={false} />);
              expect(screen.getByRole('button', { name: 'Test Button' })).not.toBeDisabled();
            }
          },
          {
            name: 'disabled undefined defaults to enabled',
            run: () => {
              render(<Button {...defaultProps} />);
              expect(screen.getByRole('button', { name: 'Test Button' })).not.toBeDisabled();
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  describe('CSS Variables and Styling', () => {
    it('applies shared styles across variants', async () => {
      await runScenarios(
        [
          {
            name: 'section variant sets css variables',
            run: () => {
              render(<Button {...defaultProps} variant="section" sectionColor={{ base: '#10B981', light: '#6EE7B7', dark: '#047857' }} />);
              expect(screen.getByRole('button', { name: 'Test Button' })).toHaveStyle({ '--hover-bg': '#047857' });
            }
          },
          {
            name: 'base classes persist across variants',
            run: () => {
              (['default', 'primary', 'secondary', 'section'] as const).forEach((variant) => {
                const { unmount } = render(
                  <Button
                    {...defaultProps}
                    variant={variant}
                    sectionColor={variant === 'section' ? { base: '#000', light: '#333', dark: '#666' } : undefined}
                  />
                );
                expect(screen.getByRole('button', { name: 'Test Button' })).toHaveClass('px-4', 'py-2');
                unmount();
              });
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  describe('Edge Cases', () => {
    it('handles unusual props gracefully', async () => {
      await runScenarios(
        [
          {
            name: 'empty children',
            run: () => {
              render(<Button children="" />);
              expect(screen.getByRole('button')).toHaveTextContent('');
            }
          },
          {
            name: 'nullable onClick',
            run: () => {
              render(<Button {...defaultProps} onClick={undefined} />);
              expect(() => fireEvent.click(screen.getByRole('button', { name: 'Test Button' }))).not.toThrow();
            }
          },
          {
            name: 'empty className allowed',
            run: () => {
              render(<Button {...defaultProps} className="" />);
              expect(screen.getByRole('button', { name: 'Test Button' })).toBeInTheDocument();
            }
          },
          {
            name: 'undefined className allowed',
            run: () => {
              render(<Button {...defaultProps} className={undefined} />);
              expect(screen.getByRole('button', { name: 'Test Button' })).toBeInTheDocument();
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  describe('Integration', () => {
    it('covers integration scenarios', async () => {
      await runScenarios(
        [
          {
            name: 'combines multiple props',
            run: () => {
              const handleClick = jest.fn();
              render(
                <Button
                  variant="primary"
                  onClick={handleClick}
                  className="integration-test-class"
                  title="Integration test button"
                >
                  Integration Button
                </Button>
              );
              const button = screen.getByRole('button', { name: 'Integration Button' });
              fireEvent.click(button);
              expect(handleClick).toHaveBeenCalled();
            }
          },
          {
            name: 'reuses children across variants',
            run: () => {
              (['default', 'primary', 'secondary'] as const).forEach((variant) => {
                const { unmount } = render(<Button variant={variant}>Same Content</Button>);
                expect(screen.getByRole('button', { name: 'Same Content' })).toHaveTextContent('Same Content');
                unmount();
              });
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });
});
