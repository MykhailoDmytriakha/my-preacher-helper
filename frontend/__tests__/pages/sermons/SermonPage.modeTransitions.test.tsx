import React from 'react';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
jest.mock('@locales/i18n', () => ({}));
import SermonPage from '@/(pages)/(private)/sermons/[id]/page';

// Mock dynamic AudioRecorder
jest.mock('@/components/AudioRecorder', () => ({
  __esModule: true,
  AudioRecorder: ({}) => <div data-testid="audio-recorder" />,
}));

let modeValue: string | null = null;
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'abc' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => ({ get: (k: string) => (k === 'mode' ? modeValue : null) }),
}));

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
  test('classic mode shows recorder and brainstorm', async () => {
    // By default mode is null => classic
    render(<SermonPage />);
    expect(await screen.findByTestId('audio-recorder')).toBeInTheDocument();
    expect(screen.getByTestId('brainstorm')).toBeInTheDocument();
  });

  test('prep mode hides recorder and brainstorm', async () => {
    modeValue = 'prep';
    render(<SermonPage />);
    expect(screen.queryByTestId('audio-recorder')).not.toBeInTheDocument();
    expect(screen.queryByTestId('brainstorm')).not.toBeInTheDocument();
  });
});


