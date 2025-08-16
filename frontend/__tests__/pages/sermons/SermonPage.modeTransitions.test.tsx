import React from 'react';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
jest.mock('@locales/i18n', () => ({}));
import SermonPage from '@/(pages)/(private)/sermons/[id]/page';

// Mock dynamic AudioRecorder
jest.mock('@/components/AudioRecorder', () => ({
  __esModule: true,
  AudioRecorder: ({}) => <div data-testid="audio-recorder" />,
}));

let modeValue: string | null = null;
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
    modeValue = null;
    searchParamsMock = new URLSearchParams();
    routerMock = { push: jest.fn(), replace: jest.fn() };
    mockLocalStorage.getItem.mockReturnValue(null);
    mockLocalStorage.setItem.mockClear();
  });

  test('classic mode shows recorder and brainstorm', async () => {
    // By default mode is null => classic
    render(<SermonPage />);
    expect(await screen.findByTestId('audio-recorder')).toBeInTheDocument();
    expect(screen.getByTestId('brainstorm')).toBeInTheDocument();
  });

  test('prep mode hides recorder and brainstorm', async () => {
    searchParamsMock.set('mode', 'prep');
    render(<SermonPage />);
    expect(screen.queryByTestId('audio-recorder')).not.toBeInTheDocument();
    expect(screen.queryByTestId('brainstorm')).not.toBeInTheDocument();
  });

  test('initializes mode from URL param when present', async () => {
    searchParamsMock.set('mode', 'prep');
    render(<SermonPage />);
    
    await waitFor(() => {
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('sermon-abc-mode', 'prep');
    });
  });

  test('initializes mode from localStorage when URL param is not present', async () => {
    mockLocalStorage.getItem.mockReturnValue('prep');
    render(<SermonPage />);
    
    await waitFor(() => {
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('sermon-abc-mode', 'classic');
    });
  });

  test('defaults to classic mode when no URL param or localStorage value', async () => {
    render(<SermonPage />);
    
    await waitFor(() => {
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('sermon-abc-mode', 'classic');
    });
  });

  test('syncs mode with URL params on mount', async () => {
    searchParamsMock.set('mode', 'prep');
    render(<SermonPage />);
    
    await waitFor(() => {
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('sermon-abc-mode', 'prep');
    });
  });

  test('handles mode changes and persists to localStorage', async () => {
    const { rerender } = render(<SermonPage />);
    
    // Initial render with no mode
    await waitFor(() => {
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('sermon-abc-mode', 'classic');
    });

    // Change mode to prep
    searchParamsMock.set('mode', 'prep');
    rerender(<SermonPage />);
    
    await waitFor(() => {
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('sermon-abc-mode', 'prep');
    });
  });

  test('handles deep link to specific prep step', async () => {
    searchParamsMock.set('mode', 'prep');
    searchParamsMock.set('prepStep', 'spiritual');
    render(<SermonPage />);
    
    // Should render in prep mode
    expect(screen.queryByTestId('audio-recorder')).not.toBeInTheDocument();
    expect(screen.queryByTestId('brainstorm')).not.toBeInTheDocument();
  });

  test('handles multiple search params correctly', async () => {
    searchParamsMock.set('mode', 'prep');
    searchParamsMock.set('prepStep', 'exegeticalPlan');
    searchParamsMock.set('otherParam', 'value');
    
    render(<SermonPage />);
    
    await waitFor(() => {
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('sermon-abc-mode', 'prep');
    });
  });

  test('handles empty search params gracefully', async () => {
    searchParamsMock = new URLSearchParams('');
    render(<SermonPage />);
    
    await waitFor(() => {
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('sermon-abc-mode', 'classic');
    });
  });

  test('handles invalid mode values gracefully', async () => {
    searchParamsMock.set('mode', 'invalid');
    render(<SermonPage />);
    
    await waitFor(() => {
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('sermon-abc-mode', 'classic');
    });
  });
});


