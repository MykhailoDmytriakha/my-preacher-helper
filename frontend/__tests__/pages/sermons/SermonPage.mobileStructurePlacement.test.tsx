import { render, screen } from '@testing-library/react';
import React from 'react';
import '@testing-library/jest-dom';

// Utilities
const isBefore = (a: Element, b: Element) => {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
};

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'sermon-xyz' }),
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

// Important: Keep two distinct instances detectable
jest.mock('@/components/sermon/StructureStats', () => () => (
  <div data-testid="structure-stats">StructureStats</div>
));

import SermonPage from '@/(pages)/(private)/sermons/[id]/page';

import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';

import { documentEngineHarness } from '../../../test-utils/documentEngineHarness';
import { TestProviders } from '../../../test-utils/test-providers';

const resource = { collection: 'sermons', id: 'sermon-xyz' };

describe('SermonPage mobile ThoughtsBySection placement', () => {
  it('renders ThoughtsBySection section between header export buttons and audio recorder (DOM order)', async () => {
    const harness = documentEngineHarness({
      resource,
      value: {
        userId: 'owner', title: 'Mobile Placement Test Sermon', verse: 'Ps. 23:1', date: '2024-01-01', thoughts: [],
        structure: { introduction: [], main: [], conclusion: [], ambiguous: [] },
      },
      metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false },
    });
    jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
    const { container } = render(
      <TestProviders>
        <DataEngineProvider>
          <SermonPage />
        </DataEngineProvider>
      </TestProviders>
    );

    const headerExport = await screen.findByTestId('export-buttons');
    // AudioRecorder is dynamically imported with ssr: false: the loading fallback stands in the same
    // place until the module arrives, and the (mocked) recorder replaces it there.
    const recorder = await screen.findByText(/^(Loading recorder\.\.\.|AudioRecorder)$/);
    const stats = screen.getAllByTestId('structure-stats');

    // Both mobile and desktop instances render (CSS classes are not applied in JSDOM)
    expect(stats.length).toBeGreaterThanOrEqual(2);

    const mobileStats = stats[0]; // The first instance appears right after the header in DOM

    // Assert DOM order: header export buttons -> mobile StructureStats -> audio recorder
    expect(isBefore(headerExport, mobileStats)).toBe(true);
    expect(isBefore(mobileStats, recorder)).toBe(true);

    // Sanity: second instance exists later in the DOM
    if (stats[1]) {
      expect(isBefore(mobileStats, stats[1])).toBe(true);
    }
    // Avoid unused var warning
    expect(container).toBeInTheDocument();
  });
});
