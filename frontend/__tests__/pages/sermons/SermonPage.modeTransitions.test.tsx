import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
jest.mock('@locales/i18n', () => ({}));
import SermonPage from '@/(pages)/(private)/sermons/[id]/page';

import { TestProviders } from '../../../test-utils/test-providers';

// Mock dynamic AudioRecorder
jest.mock('@/components/AudioRecorder', () => ({
  __esModule: true,
  AudioRecorder: ({}) => <div data-testid="audio-recorder" />,
}));

let searchParamsMock: URLSearchParams;
let routerMock: any;

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'abc' }),
  useRouter: () => routerMock,
  useSearchParams: () => searchParamsMock,
}));

// Mock localStorage
const mockLocalStorage = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
};

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
});

// Minimal mocks for hooks/services used by page
jest.mock('@/hooks/useSermon', () => () => ({
  sermon: { id: 'abc', userId: 'u1', date: '2024-01-01', title: 'T', verse: '', thoughts: [], outline: { introduction: [], main: [], conclusion: [] } },
  setSermon: jest.fn(),
  loading: false,
  refreshSermon: jest.fn(),
}));

jest.mock('@/services/tag.service', () => ({ getTags: async () => ({ requiredTags: [], customTags: [] }) }));
jest.mock('@/components/sermon/SermonHeader', () => ({ __esModule: true, default: ({}) => <div data-testid="sermon-header" /> }));
jest.mock('@/components/sermon/BrainstormModule', () => ({ __esModule: true, default: ({}) => <div data-testid="brainstorm" /> }));
jest.mock('@/components/sermon/ThoughtList', () => ({ __esModule: true, default: ({}) => <div data-testid="thought-list" /> }));
jest.mock('@/components/sermon/ThoughtFilterControls', () => ({ __esModule: true, default: ({}) => null }));
jest.mock('@/components/sermon/StructurePreview', () => ({ __esModule: true, default: ({}) => null }));
jest.mock('@/components/sermon/SermonOutline', () => ({ __esModule: true, default: ({}) => <div data-testid="outline" /> }));
jest.mock('@/components/sermon/KnowledgeSection', () => ({ __esModule: true, default: ({}) => <div data-testid="knowledge" /> }));
jest.mock('@/components/sermon/StructureStats', () => ({ __esModule: true, default: ({}) => <div data-testid="stats" /> }));

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

describe('SermonPage mode transitions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    searchParamsMock = new URLSearchParams();
    routerMock = { push: jest.fn(), replace: jest.fn() };
    mockLocalStorage.getItem.mockReturnValue(null);
    mockLocalStorage.setItem.mockClear();
  });

  test('classic mode shows recorder and brainstorm trigger button', async () => {
    // By default mode is null => classic
    render(
      <TestProviders>
        <SermonPage />
      </TestProviders>
    );
    expect(await screen.findByTestId('audio-recorder')).toBeInTheDocument();
    
    // Brainstorm button should be visible
    const brainstormButton = screen.getByLabelText('brainstorm.title');
    expect(brainstormButton).toBeInTheDocument();
    
    // Brainstorm module should not be visible initially
    expect(screen.queryByTestId('brainstorm')).not.toBeInTheDocument();
    
    // Click to open brainstorm
    fireEvent.click(brainstormButton);
    
    // Now brainstorm module should be visible
    await waitFor(() => {
      expect(screen.getByTestId('brainstorm')).toBeInTheDocument();
    });
  });

  test('prep mode shows mini recorder and hides brainstorm', async () => {
    searchParamsMock.set('mode', 'prep');
    render(
      <TestProviders>
        <SermonPage />
      </TestProviders>
    );
    expect(await screen.findByTestId('audio-recorder')).toBeInTheDocument();
    
    // Brainstorm button should not be visible in prep mode
    expect(screen.queryByLabelText('brainstorm.title')).not.toBeInTheDocument();
    expect(screen.queryByTestId('brainstorm')).not.toBeInTheDocument();
  });

  test('initializes mode from URL param when present', async () => {
    searchParamsMock.set('mode', 'prep');
    render(
      <TestProviders>
        <SermonPage />
      </TestProviders>
    );

    await waitFor(() => {
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('sermon-abc-mode', 'prep');
    });
  });

  test('initializes mode from localStorage when URL param is not present', async () => {
    mockLocalStorage.getItem.mockReturnValue('prep');
    render(
      <TestProviders>
        <SermonPage />
      </TestProviders>
    );

    await waitFor(() => {
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('sermon-abc-mode', 'classic');
    });
  });

  test('defaults to classic mode when no URL param or localStorage value', async () => {
    render(
      <TestProviders>
        <SermonPage />
      </TestProviders>
    );

    await waitFor(() => {
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('sermon-abc-mode', 'classic');
    });
  });

  test('syncs mode with URL params on mount', async () => {
    searchParamsMock.set('mode', 'prep');
    render(
      <TestProviders>
        <SermonPage />
      </TestProviders>
    );

    await waitFor(() => {
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('sermon-abc-mode', 'prep');
    });
  });

  test('handles mode changes and persists to localStorage', async () => {
    const { rerender } = render(
      <TestProviders>
        <SermonPage />
      </TestProviders>
    );

    // Initial render with no mode
    await waitFor(() => {
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('sermon-abc-mode', 'classic');
    });

    // Change mode to prep
    searchParamsMock.set('mode', 'prep');
    rerender(
      <TestProviders>
        <SermonPage />
      </TestProviders>
    );
    
    await waitFor(() => {
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('sermon-abc-mode', 'prep');
    });
  });

  test('handles deep link to specific prep step', async () => {
    searchParamsMock.set('mode', 'prep');
    searchParamsMock.set('prepStep', 'spiritual');
    render(
      <TestProviders>
        <SermonPage />
      </TestProviders>
    );

    // Should render in prep mode
    expect(await screen.findByTestId('audio-recorder')).toBeInTheDocument();
    expect(screen.queryByTestId('brainstorm')).not.toBeInTheDocument();
  });

  test('handles multiple search params correctly', async () => {
    searchParamsMock.set('mode', 'prep');
    searchParamsMock.set('prepStep', 'exegeticalPlan');
    searchParamsMock.set('otherParam', 'value');

    render(
      <TestProviders>
        <SermonPage />
      </TestProviders>
    );

    await waitFor(() => {
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('sermon-abc-mode', 'prep');
    });
  });

  test('handles empty search params gracefully', async () => {
    searchParamsMock = new URLSearchParams('');
    render(
      <TestProviders>
        <SermonPage />
      </TestProviders>
    );

    await waitFor(() => {
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('sermon-abc-mode', 'classic');
    });
  });

  test('handles invalid mode values gracefully', async () => {
    searchParamsMock.set('mode', 'invalid');
    render(
      <TestProviders>
        <SermonPage />
      </TestProviders>
    );

    await waitFor(() => {
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('sermon-abc-mode', 'classic');
    });
  });
});

