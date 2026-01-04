import { render, screen } from '@testing-library/react';
import React from 'react';

import FocusModeLayout from '@/components/FocusModeLayout';

describe('FocusModeLayout', () => {
  it('renders sidebar and content with base layout classes', () => {
    render(
      <FocusModeLayout
        className="custom-class"
        sidebar={<div data-testid="sidebar">Sidebar</div>}
        content={<div data-testid="content">Content</div>}
      />
    );

    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('content')).toBeInTheDocument();

    const wrapper = screen.getByTestId('sidebar').parentElement;
    expect(wrapper).toHaveClass('flex');
    expect(wrapper).toHaveClass('gap-6');
    expect(wrapper).toHaveClass('justify-center');
    expect(wrapper).toHaveClass('w-full');
    expect(wrapper).toHaveClass('custom-class');
  });
});
