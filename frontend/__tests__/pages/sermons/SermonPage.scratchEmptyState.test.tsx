import { render, screen } from '@testing-library/react';
import React from 'react';
import '@testing-library/jest-dom';

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'sermon-xyz' }),
  usePathname: () => '/sermons/sermon-xyz',
  useSearchParams: () => ({ get: () => null }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}));

// Mock i18n
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// The page runs on the data engine: it opens the sermon document through the real engine,
// with only the server and the browser transport replaced.
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' }, loading: false }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@/components/thought/EngineThoughtModal', () => ({ EngineThoughtModal: () => null }));
jest.mock('@/(pages)/(private)/sermons/[id]/components/EngineScratchWorkspace', () => ({ EngineScratchWorkspace: () => <div>Scratch</div> }));

// Mock lightweight child components
jest.mock('@/components/sermon/SermonHeader', () => () => (
  <div data-testid="sermon-header">
    <div data-testid="export-buttons">ExportButtons</div>
  </div>
));

jest.mock('@components/AudioRecorder', () => ({
  AudioRecorder: () => <div data-testid="audio-recorder">AudioRecorder</div>,
}));

jest.mock('@/components/sermon/KnowledgeSection', () => () => (
  <div data-testid="knowledge-section">KnowledgeSection</div>
));

jest.mock('@/components/sermon/SermonOutline', () => () => (
  <div data-testid="sermon-outline">SermonOutline</div>
));

jest.mock('@/components/sermon/StructurePreview', () => () => (
  <div data-testid="structure-preview">StructurePreview</div>
));

jest.mock('@/components/sermon/StructureStats', () => () => (
  <div data-testid="structure-stats">StructureStats</div>
));

import SermonPage from '@/(pages)/(private)/sermons/[id]/page';

import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';

import { documentEngineHarness } from '../../../test-utils/documentEngineHarness';
import { TestProviders } from '../../../test-utils/test-providers';

const resource = { collection: 'sermons', id: 'sermon-xyz' };

/**
 * A sermon begun from scratch notes, with no thought yet, says so in the thoughts column and
 * offers the notes. The page used to hand the column the legacy scratch hook's list, which is
 * always empty on an engine document, so the offer never appeared.
 */
describe('SermonPage empty thoughts column with scratch notes', () => {
  it('offers the scratch notes stored in the engine document', async () => {
    const harness = documentEngineHarness({
      resource,
      value: {
        userId: 'owner', title: 'Begun from scratch', verse: 'Ps. 23:1', date: '2024-01-01', thoughts: [],
        scratch: [{ id: 'atom-1', text: 'First scratch note', createdAt: '2026-10-12T00:00:00.000Z' }],
        structure: { introduction: [], main: [], conclusion: [], ambiguous: [] },
      },
      metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false },
    });
    jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
    render(
      <TestProviders>
        <DataEngineProvider>
          <SermonPage />
        </DataEngineProvider>
      </TestProviders>
    );

    expect((await screen.findAllByText('sermon.materialEmpty.atomsBandNoNote')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('First scratch note').length).toBeGreaterThan(0);
  });
});
