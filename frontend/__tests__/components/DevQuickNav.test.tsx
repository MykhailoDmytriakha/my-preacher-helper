import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

// Set env for tests
const OLD_ENV = process.env;

describe('DevQuickNav', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('does not render when flag is off', async () => {
    // Simulate browser
    (global as any).window = Object.create(window);
    Object.defineProperty(window, 'location', {
      value: { hostname: 'localhost' },
      writable: true,
    });
    process.env.NEXT_PUBLIC_ENABLE_DEV_NAV = '0';
    // Mock environment
    (process.env as any).NODE_ENV = 'test';

    const DevQuickNav = (await import('@/components/navigation/DevQuickNav')).default;
    render(<DevQuickNav />);
    expect(screen.queryByText(/Dev Quick Nav/i)).not.toBeInTheDocument();
  });

  it('renders when local and flag is on', async () => {
    (global as any).window = Object.create(window);
    Object.defineProperty(window, 'location', {
      value: { hostname: 'localhost' },
      writable: true,
    });
    process.env.NEXT_PUBLIC_ENABLE_DEV_NAV = '1';
    (process.env as any).NODE_ENV = 'test';

    const DevQuickNav = (await import('@/components/navigation/DevQuickNav')).default;
    render(<DevQuickNav />);
    expect(await screen.findByText(/Dev Quick Nav/i)).toBeInTheDocument();
    // Basic links visible
    expect(await screen.findByText('Dashboard')).toBeInTheDocument();
    expect(await screen.findByText('Settings')).toBeInTheDocument();
  });
});


