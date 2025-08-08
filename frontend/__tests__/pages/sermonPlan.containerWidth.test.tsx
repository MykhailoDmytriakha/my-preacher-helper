import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';

// Router mocks
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'test-sermon-id' }),
  useRouter: () => ({ push: jest.fn() }),
}));

// i18n mock
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
  }),
}));

// Service and child mocks to avoid heavy render
jest.mock('@/services/plan.service', () => ({
  getSermonPlan: jest.fn(),
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
    const { container, findByTestId } = render(<SermonPlanPage />);
    // Root should have data-testid and no min-h-screen
    const root = await findByTestId('sermon-plan-page-container');
    expect(root).toBeInTheDocument();
    expect((root as HTMLElement).className).not.toMatch(/min-h-screen/);
  });
});


