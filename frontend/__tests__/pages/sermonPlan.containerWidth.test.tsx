import { render, screen } from '@testing-library/react';
import React from 'react';
import '@testing-library/jest-dom';

// Mock window.matchMedia for JSDOM
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(), // deprecated
    removeListener: jest.fn(), // deprecated
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

// Router mocks
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'test-sermon-id' }),
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/sermons/test-sermon-id/plan',
}));

// i18n mock
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
  }),
}));

// Service and child mocks to avoid heavy render
jest.mock('@/services/plan.service', () => ({
  generateSermonPlan: jest.fn(),
}));
jest.mock('@/services/sermon.service', () => ({
  getSermonById: jest.fn(async () => ({
    id: 'test-sermon-id',
    title: 'T',
    verse: 'V',
    thoughts: [],
    outline: { introduction: [], main: [], conclusion: [] },
  })),
}));
jest.mock('@/components/plan/KeyFragmentsModal', () => () => <div/>);
jest.mock('@/components/ExportButtons', () => () => <div/>);

import SermonPlanPage from '@/(pages)/(private)/sermons/[id]/plan/page';

describe('Sermon plan container width', () => {
  it('does not use min-h-screen and keeps page container lightweight', async () => {
    render(<SermonPlanPage />);
    // Root should have data-testid and no min-h-screen
    const root = await screen.findByTestId('sermon-plan-page-container');
    expect(root).toBeInTheDocument();
    expect((root as HTMLElement).className).not.toMatch(/min-h-screen/);
  });
});

