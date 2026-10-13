import { render, screen } from '@testing-library/react';
import React from 'react';
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

// The page runs on the data engine: it opens the sermon document through the real engine,
// with only the server and the browser transport replaced.
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' }, loading: false }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@/components/thought/EngineThoughtModal', () => ({ EngineThoughtModal: () => null }));
jest.mock('@/(pages)/(private)/sermons/[id]/components/EngineScratchWorkspace', () => ({ EngineScratchWorkspace: () => <div>Scratch</div> }));
jest.mock('@/components/sermon/SermonHeader', () => () => <div>Header</div>);
jest.mock('@components/AudioRecorder', () => ({ AudioRecorder: () => <div>Recorder</div> }));
jest.mock('@components/EditThoughtModal', () => () => <div>EditModal</div>);
jest.mock('@components/sermon/BrainstormModule', () => () => <div>Brainstorm</div>);
jest.mock('@components/sermon/ThoughtList', () => () => <div>ThoughtList</div>);
jest.mock('@components/sermon/KnowledgeSection', () => () => <div>Knowledge</div>);
jest.mock('@components/sermon/StructureStats', () => () => <div>Stats</div>);
jest.mock('@components/sermon/SermonOutline', () => () => <div>SermonOutline</div>);

import SermonDetailPage from '@/(pages)/(private)/sermons/[id]/page';

import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';

import { documentEngineHarness } from '../../test-utils/documentEngineHarness';
import { TestProviders } from '../../test-utils/test-providers';

const resource = { collection: 'sermons', id: 'test-sermon-id' };

describe('Sermon detail container width', () => {
  it('uses fluid container without fixed max width', async () => {
    const harness = documentEngineHarness({
      resource,
      value: { userId: 'owner', title: 'Test Sermon', thoughts: [], structure: {} },
      metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false },
    });
    jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
    const { container } = render(
      <TestProviders>
        <DataEngineProvider>
          <SermonDetailPage />
        </DataEngineProvider>
      </TestProviders>
    );
    // The sermon has arrived: the layout assertions below would pass on a skeleton too.
    await screen.findByText('Header');
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


