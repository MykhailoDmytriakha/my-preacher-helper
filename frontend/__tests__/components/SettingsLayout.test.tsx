import { render, screen } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import SettingsLayout from '@/components/settings/SettingsLayout';

describe('SettingsLayout', () => {
  it('renders content-only without max width or min-h-screen', () => {
    render(
      <SettingsLayout title="Settings">
        <div data-testid="child">Child</div>
      </SettingsLayout>
    );

    // Should render child
    expect(screen.getByTestId('child')).toBeInTheDocument();

    // Container should not include max-w-7xl or min-h-screen in class names
    const layoutRoot = screen.getByText('Settings').closest('div');
    expect(layoutRoot).toBeInTheDocument();
    if (layoutRoot) {
      expect(layoutRoot.className).not.toMatch(/max-w-7xl/);
      expect(layoutRoot.className).not.toMatch(/min-h-screen/);
    }
  });
});


