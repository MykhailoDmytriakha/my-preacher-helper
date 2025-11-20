import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock router params
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'test-sermon-id' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  usePathname: jest.fn().mockReturnValue('/'),
  useSearchParams: () => ({ get: () => null, toString: () => '' })
}));

// Mock i18n
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
  }),
}));

// Mock hooks/services and heavy child components
jest.mock('@/hooks/useSermon', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    sermon: {
      id: 'test-sermon-id',
      title: 'Test Sermon',
      thoughts: [],
      structure: {},
    },
    loading: false,
    setSermon: jest.fn(),
    refreshSermon: jest.fn(),
  })),
}));
jest.mock('@/components/sermon/SermonHeader', () => () => <div>Header</div>);
jest.mock('@components/AudioRecorder', () => ({ AudioRecorder: () => <div>Recorder</div> }));
jest.mock('@components/AddThoughtManual', () => () => <div>AddThought</div>);
jest.mock('@components/EditThoughtModal', () => () => <div>EditModal</div>);
jest.mock('@components/sermon/BrainstormModule', () => () => <div>Brainstorm</div>);
jest.mock('@components/sermon/ThoughtList', () => () => <div>ThoughtList</div>);
jest.mock('@components/sermon/KnowledgeSection', () => () => <div>Knowledge</div>);
jest.mock('@components/sermon/StructureStats', () => () => <div>Stats</div>);
jest.mock('@components/sermon/SermonOutline', () => () => <div>SermonOutline</div>);

import SermonDetailPage from '@/(pages)/(private)/sermons/[id]/page';
import { TestProviders } from '../../test-utils/test-providers';

describe('Sermon detail container width', () => {
  it('uses fluid container without fixed max width', () => {
    const { container } = render(
      <TestProviders>
        <SermonDetailPage />
      </TestProviders>
    );
    // Should not contain legacy fixed width classes
    expect(container.querySelector('.max-w-7xl')).toBeNull();
    expect(container.querySelector('.max-w-4xl')).toBeNull();
    // Page component itself should not add layout-level containers (provided by private layout)
    const hasPageLevelContainer = Array.from(container.querySelectorAll('div')).some((el) =>
      el.className.includes('mx-auto') || el.className.includes('px-4') || el.className.includes('lg:px-8')
    );
    expect(hasPageLevelContainer).toBe(false);
  });
});


