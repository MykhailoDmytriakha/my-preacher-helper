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

// Sermon and services mocks
jest.mock('@/hooks/useSermon', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    sermon: { id: 'test-sermon-id', title: 'S', verse: 'V' },
    loading: false,
    setSermon: jest.fn(),
  })),
}));
jest.mock('@/hooks/useSermonValidator', () => ({
  __esModule: true,
  default: jest.fn(() => ({ isPlanAccessible: true })),
}));
jest.mock('@/services/plan.service', () => ({
  getSermonPlan: jest.fn(),
  generateSermonPlan: jest.fn(),
}));

import SermonOutlinePage from '@/(pages)/(private)/sermons/[id]/outline/page';

describe('Sermon outline container width', () => {
  it('uses fluid container without fixed max width', () => {
    const { container } = render(<SermonOutlinePage />);
    expect(container.querySelector('.max-w-7xl')).toBeNull();
    expect(container.querySelector('.max-w-4xl')).toBeNull();
    const fluid = Array.from(container.querySelectorAll('div')).find((el) =>
      el.className.includes('mx-auto') && el.className.includes('px-4')
    );
    expect(fluid).toBeTruthy();
  });
});


