import { render, screen } from '@testing-library/react';
import React from 'react';

import FocusSidebar from '@/components/FocusSidebar';

describe('FocusSidebar', () => {
  it('renders header, actions, and points with sidebar styling', () => {
    const { container } = render(
      <FocusSidebar
        visible={true}
        style={{ backgroundColor: 'rgb(1, 2, 3)' }}
        header={<div>Header</div>}
        actions={<div>Actions</div>}
        points={<div>Points</div>}
      />
    );

    expect(screen.getByText('Header')).toBeInTheDocument();
    expect(screen.getByText('Actions')).toBeInTheDocument();
    expect(screen.getByText('Points')).toBeInTheDocument();

    const outer = container.firstChild as HTMLElement;
    expect(outer).toHaveClass('lg:w-72');
    expect(outer).toHaveClass('sticky');

    const panel = outer.querySelector('.bg-gray-50') as HTMLElement;
    expect(panel).toBeInTheDocument();
    expect(panel.className).toContain('dark:bg-gray-800');
    expect(panel.style.backgroundColor).toBe('rgb(1, 2, 3)');
  });

  it('applies hidden state when not visible', () => {
    const { container } = render(
      <FocusSidebar
        visible={false}
        header={<div>Header</div>}
        actions={<div>Actions</div>}
        points={<div>Points</div>}
      />
    );

    const outer = container.firstChild as HTMLElement;
    expect(outer).toHaveClass('hidden');
    expect(outer).toHaveClass('md:block');
  });
});
