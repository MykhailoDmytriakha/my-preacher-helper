import React from 'react';
import { render, screen } from '@testing-library/react';
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

// Mock data hook
jest.mock('@/hooks/useSermon', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    sermon: {
      id: 'sermon-xyz',
      title: 'Mobile Placement Test Sermon',
      verse: 'Ps. 23:1',
      date: '2024-01-01',
      thoughts: [],
      structure: {
        introduction: [],
        main: [],
        conclusion: [],
        ambiguous: [],
      },
    },
    setSermon: jest.fn(),
    loading: false,
  })),
}));

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

describe('SermonPage mobile ThoughtsBySection placement', () => {
  it('renders ThoughtsBySection section between header export buttons and audio recorder (DOM order)', () => {
    const { container } = render(<SermonPage />);

    const headerExport = screen.getByTestId('export-buttons');
    // AudioRecorder is dynamically imported with ssr: false; tests render the loading fallback
    const recorder = screen.getByText('Loading recorder...');
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
