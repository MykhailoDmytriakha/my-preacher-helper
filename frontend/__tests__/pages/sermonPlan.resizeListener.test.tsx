import { render } from '@testing-library/react';
import React from 'react';
import '@testing-library/jest-dom';

// Minimal mocks
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue || k }),
}));
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'test-sermon-id' }),
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/sermons/test-sermon-id/plan',
}));
jest.mock('@/services/sermon.service', () => ({
  getSermonById: jest.fn(async () => null), // keep simple, we don't rely on data here
}));
jest.mock('@/components/ExportButtons', () => () => <div/>);
jest.mock('@/components/plan/KeyFragmentsModal', () => () => <div/>);

import SermonPlanPage from '@/(pages)/(private)/sermons/[id]/plan/page';

describe('PlanPage resize listener', () => {
  it('attaches and detaches resize listener', () => {
    const addSpy = jest.spyOn(window, 'addEventListener');
    const removeSpy = jest.spyOn(window, 'removeEventListener');

    const { unmount } = render(<SermonPlanPage />);

    expect(addSpy).toHaveBeenCalledWith('resize', expect.any(Function));

    unmount();

    expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function));

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});

