import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
jest.mock('@/hooks/useDocumentFreshness', () => ({
  useDocumentFreshness: jest.fn(() => ({ state: 'fresh', remote: null, remotelyDeleted: false, markSynced: jest.fn() })),
}));

jest.mock('@locales/i18n', () => ({}));
import { useSermonThoughtsDataDocument } from '@/(pages)/(private)/sermons/[id]/hooks/useSermonThoughtsDataDocument';
import { EngineOutlineModal } from '@/components/sermon/EngineOutlineModal';
import { EngineThoughtModal } from '@/components/thought/EngineThoughtModal';
import ThoughtList from '@/components/sermon/ThoughtList';
import SermonPage from '@/(pages)/(private)/sermons/[id]/page';
import { EngineScratchWorkspace } from '@/(pages)/(private)/sermons/[id]/components/EngineScratchWorkspace';
import { useScratchNotes } from '@/(pages)/(private)/sermons/[id]/hooks/useScratchNotes';
import { useSermonCoreDataDocument } from '@/(pages)/(private)/sermons/[id]/hooks/useSermonCoreDataDocument';
import SermonHeader from '@/components/sermon/SermonHeader';
import TextContextStepContent from '@/components/sermon/prep/TextContextStepContent';
import SpiritualStepContent from '@/components/sermon/prep/SpiritualStepContent';
import ThesisStepContent from '@/components/sermon/prep/ThesisStepContent';
import ExegeticalPlanStepContent from '@/components/sermon/prep/ExegeticalPlanStepContent';
import { DataDocumentProvider } from '@/data-engine/react.client';
import { useDocumentFreshness } from '@/hooks/useDocumentFreshness';
import useSermon from '@/hooks/useSermon';

import { TestProviders } from '../../../test-utils/test-providers';

// Mock dynamic AudioRecorder
jest.mock('@/components/AudioRecorder', () => ({
  __esModule: true,
  AudioRecorder: ({}) => <div data-testid="audio-recorder" />,
}));

let searchParamsMock: URLSearchParams;
let routerMock: any;
let mockEngineEnabled = false;
const mockSetSermon = jest.fn();
let mockCore: ReturnType<typeof useSermonCoreDataDocument>;

jest.mock('@/data-engine/react.client', () => ({
  isDataEngineEnabled: () => mockEngineEnabled,
  // The page asks about its own collection: activation is per migrated domain.
  isCollectionOnEngine: (collection: string) => collection === 'sermons' && mockEngineEnabled,
  DataDocumentProvider: jest.fn(({ children }: { children: React.ReactNode }) => <div data-testid="document-provider">{children}</div>),
}));
jest.mock('@/(pages)/(private)/sermons/[id]/hooks/useSermonCoreDataDocument', () => ({
  useSermonCoreDataDocument: jest.fn(() => mockCore),
}));
jest.mock('@/(pages)/(private)/sermons/[id]/hooks/useSermonThoughtsDataDocument', () => ({
  useSermonThoughtsDataDocument: jest.fn(() => ({ patchThought: jest.fn(async () => undefined), deleteThought: jest.fn(async () => undefined) })),
}));
jest.mock('@/components/sermon/EngineOutlineModal', () => ({ EngineOutlineModal: jest.fn(() => <div data-testid="engine-outline-modal" />) }));
jest.mock('@/components/thought/EngineThoughtModal', () => ({ EngineThoughtModal: jest.fn(() => <div data-testid="engine-thought-modal" />) }));
jest.mock('@/(pages)/(private)/sermons/[id]/components/EngineScratchWorkspace', () => ({
  EngineScratchWorkspace: jest.fn(() => <div data-testid="engine-scratch-workspace" />),
}));
jest.mock('@/(pages)/(private)/sermons/[id]/hooks/useScratchNotes', () => ({
  useScratchNotes: jest.fn(() => ({ notes: [], scratchRevision: 0, isWritePending: false })),
}));

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
jest.mock('@/hooks/useSermon', () => {
  const useSermonMock = Object.assign(jest.fn(() => ({
    sermon: { id: 'abc', userId: 'u1', date: '2024-01-01', title: 'T', verse: '', thoughts: [], outline: { introduction: [], main: [], conclusion: [] } },
    setSermon: mockSetSermon,
    loading: false,
    refreshSermon: jest.fn(),
  })), { sermonIsMissing: jest.requireActual('@/hooks/useSermon').sermonIsMissing });
  // The module is mocked AS a function here (CJS default interop), so the named rule has to
  // hang off it. It stays REAL: a stubbed rule would pass while the screens drift apart.
  useSermonMock.sermonIsMissing = jest.requireActual('@/hooks/useSermon').sermonIsMissing;
  return useSermonMock;
});

jest.mock('@/hooks/useTags', () => ({
  useTags: () => ({ allTags: [] }),
}));
// useSeries now reads via the client Firestore SDK (Phase 5: series.service is
// client-only). getClientDb() can't initialize in jsdom, so mock the hook the same
// way useSermon/useTags are mocked — the page only needs an (empty) series list.
jest.mock('@/hooks/useSeries', () => ({
  useSeries: () => ({ series: [] }),
}));
jest.mock('@/components/sermon/SermonHeader', () => ({ __esModule: true, default: jest.fn(() => <div data-testid="sermon-header" />) }));
jest.mock('@/components/sermon/prep/TextContextStepContent', () => ({ __esModule: true, default: jest.fn(() => <div data-testid="text-context" />) }));
jest.mock('@/components/sermon/prep/SpiritualStepContent', () => ({ __esModule: true, default: jest.fn(() => <div data-testid="spiritual" />) }));
jest.mock('@/components/sermon/prep/ThesisStepContent', () => ({ __esModule: true, default: jest.fn(() => <div data-testid="thesis" />) }));
jest.mock('@/components/sermon/prep/ExegeticalPlanStepContent', () => ({ __esModule: true, default: jest.fn(() => <div data-testid="exegetical" />) }));
jest.mock('@/components/sermon/prep/PrepStepCard', () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
jest.mock('@/components/sermon/BrainstormModule', () => ({ __esModule: true, default: ({}) => <div data-testid="brainstorm" /> }));
jest.mock('@/components/sermon/ThoughtList', () => ({ __esModule: true, default: jest.fn(() => <div data-testid="thought-list" />) }));
jest.mock('@/components/sermon/ThoughtFilterControls', () => ({ __esModule: true, default: ({}) => null }));
jest.mock('@/components/sermon/StructurePreview', () => ({ __esModule: true, default: ({}) => null }));
jest.mock('@/components/sermon/SermonOutline', () => ({ __esModule: true, default: ({}) => <div data-testid="outline" /> }));
jest.mock('@/components/sermon/KnowledgeSection', () => ({ __esModule: true, default: ({}) => <div data-testid="knowledge" /> }));
jest.mock('@/components/sermon/StructureStats', () => ({ __esModule: true, default: ({}) => <div data-testid="stats" /> }));
jest.mock('@/components/sermon/ScratchPanel', () => ({ __esModule: true, default: () => <div data-testid="scratch-panel">Наброски</div> }));

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

describe('SermonPage mode transitions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEngineEnabled = false;
    const data = { userId: 'u1', date: '2024-01-01', title: 'Canonical title', verse: 'Canonical verse', thoughts: [],
      preparation: { textContext: { passageSummary: 'Summary', contextNotes: 'Keep this newer value' }, thesis: { homiletical: 'Keep thesis' } } };
    mockCore = { data, coreValues: { title: data.title, verse: data.verse }, preparation: data.preparation,
      confirmed: { resource: { collection: 'sermons', id: 'abc' }, value: data, metadata: { protocol: 1, generation: 'g', revision: 2, deleted: false } },
      status: null, error: null, loading: false, isReadOnly: false,
      retry: jest.fn(async () => undefined), patchCore: jest.fn(async () => ({ delivery: 'queued' as const })),
      patchPreparation: jest.fn(async () => ({ delivery: 'queued' as const })), keepLocal: jest.fn(), acceptRemote: jest.fn(),
      titleBinding: { active: false, busy: false, value: data.title, begin: jest.fn(), update: jest.fn(), save: jest.fn(), cancel: jest.fn() },
      verseBinding: { active: false, busy: false, value: data.verse, begin: jest.fn(), update: jest.fn(), save: jest.fn(), cancel: jest.fn() },
    } as unknown as ReturnType<typeof useSermonCoreDataDocument>;
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

  test('raw mode shows scratch placeholder without recorder or brainstorm', async () => {
    searchParamsMock.set('mode', 'raw');
    render(
      <TestProviders>
        <SermonPage />
      </TestProviders>
    );

    expect(await screen.findByTestId('scratch-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('engine-scratch-workspace')).not.toBeInTheDocument();
    expect(useScratchNotes).toHaveBeenLastCalledWith(expect.objectContaining({ sermon: expect.objectContaining({ id: 'abc' }) }));
    expect(screen.queryByTestId('audio-recorder')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('brainstorm.title')).not.toBeInTheDocument();
  });

  test('uses the public engine scratch workspace in the enabled raw branch and deactivates the legacy consumer', async () => {
    mockEngineEnabled = true;
    searchParamsMock.set('mode', 'raw');
    render(<TestProviders><SermonPage /></TestProviders>);
    expect(await screen.findByTestId('engine-scratch-workspace')).toBeInTheDocument();
    expect(screen.queryByTestId('scratch-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('audio-recorder')).not.toBeInTheDocument();
    expect(useScratchNotes).toHaveBeenLastCalledWith(expect.objectContaining({ sermon: null }));
    const props = jest.mocked(EngineScratchWorkspace).mock.calls.at(-1)![0];
    expect(props.sermonId).toBe('abc');
    expect(props.isReadOnly).toBe(false);
    expect(props.onConfirmed).toBeUndefined();
    mockSetSermon.mockClear();
    expect(mockSetSermon).not.toHaveBeenCalled();
    expect(mockCore.patchCore).not.toHaveBeenCalled();
    expect(useSermon).not.toHaveBeenCalled();
    expect(DataDocumentProvider).toHaveBeenLastCalledWith(expect.objectContaining({ resource: { collection: 'sermons', id: 'abc' }, options: { slot: 'sermon' } }), undefined);
  });

  test('preserves the mounted scratch pane while the page displays preparation mode', async () => {
    mockEngineEnabled = true;
    searchParamsMock.set('mode', 'prep');
    render(<TestProviders><SermonPage /></TestProviders>);
    expect(await screen.findByTestId('sermon-header')).toBeInTheDocument();
    expect(screen.queryByTestId('audio-recorder')).not.toBeInTheDocument();
    expect(screen.getByTestId('engine-scratch-workspace')).toBeInTheDocument();
    expect(screen.queryByTestId('scratch-panel')).not.toBeInTheDocument();
    expect(useScratchNotes).toHaveBeenLastCalledWith(expect.objectContaining({ sermon: null }));
  });

  test('renders the canonical draft with the route identity and ignores confirmation-only metadata changes', () => {
    mockEngineEnabled = true;
    mockCore.data = { ...mockCore.data!, id: 'stored-id-is-not-the-route', title: 'Unsaved canonical title' };
    mockCore.coreValues = { title: 'Unsaved canonical title', verse: 'Canonical verse' };
    mockCore.confirmed = { ...mockCore.confirmed!, value: { ...mockCore.confirmed!.value!, title: 'Older confirmed title' } };
    const view = render(<TestProviders><SermonPage /></TestProviders>);
    const first = jest.mocked(SermonHeader).mock.calls.at(-1)![0];
    expect(first.sermon.id).toBe('abc');
    expect(first.sermon.title).toBe('Unsaved canonical title');
    expect(first.editor).toMatchObject({ values: mockCore.coreValues, titleForm: mockCore.titleBinding, verseForm: mockCore.verseBinding, isReadOnly: false });
    expect(useSermon).not.toHaveBeenCalled();
    expect(useDocumentFreshness).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
    expect(mockLocalStorage.getItem.mock.calls.some(([key]) => key.startsWith('prep-draft-backup-'))).toBe(false);
    mockCore.confirmed = { ...mockCore.confirmed!, metadata: { ...mockCore.confirmed!.metadata!, revision: 3, operationId: 'own-ack' } };
    view.rerender(<TestProviders><SermonPage /></TestProviders>);
    expect(jest.mocked(SermonHeader).mock.calls.at(-1)![0].sermon).toBe(first.sermon);
    expect(mockCore.patchCore).not.toHaveBeenCalled(); expect(mockCore.patchPreparation).not.toHaveBeenCalled();
    expect(mockSetSermon).not.toHaveBeenCalled();
  });

  test('sends only the intended preparation field even when the form callback holds an older render', async () => {
    mockEngineEnabled = true; searchParamsMock.set('mode', 'prep');
    render(<TestProviders><SermonPage /></TestProviders>);
    const text = jest.mocked(TextContextStepContent).mock.calls.at(-1)![0];
    const thesis = jest.mocked(ThesisStepContent).mock.calls.at(-1)![0];
    const spiritual = jest.mocked(SpiritualStepContent).mock.calls.at(-1)![0];
    const exegetical = jest.mocked(ExegeticalPlanStepContent).mock.calls.at(-1)![0];
    mockCore.preparation = { textContext: { passageSummary: 'Another saved summary', contextNotes: 'Latest sibling' } };
    await text.onSavePassageSummary!('My summary');
    await text.onSaveContextNotes!('My context');
    await text.onSaveRepeatedWords!([]);
    await text.onToggleReadWholeBookOnce!(false);
    await thesis.onSaveHomiletical!('My thesis');
    await spiritual.savePreparation({ textContext: { contextNotes: 'Stale accidental sibling' }, spiritual: { readAndPrayedConfirmed: true } });
    await exegetical.onSaveAuthorIntent!('My intention');
    await text.onSaveVerse('Acts 1');
    expect(jest.mocked(mockCore.patchPreparation).mock.calls.map(([patch]) => patch)).toEqual([
      { textContext: { passageSummary: 'My summary' } }, { textContext: { contextNotes: 'My context' } },
      { textContext: { repeatedWords: [] } }, { textContext: { readWholeBookOnceConfirmed: false } },
      { thesis: { homiletical: 'My thesis' } }, { spiritual: { readAndPrayedConfirmed: true } }, { authorIntent: 'My intention' },
    ]);
    expect(mockCore.patchCore).toHaveBeenCalledWith({ verse: 'Acts 1' });
    expect(mockSetSermon).not.toHaveBeenCalled();
  });

  test('keeps a deleted dirty document visible but locks core/preparation and disables unmigrated writers', () => {
    mockEngineEnabled = true; mockCore.isReadOnly = true;
    mockCore.confirmed = { ...mockCore.confirmed!, value: null, metadata: { ...mockCore.confirmed!.metadata!, deleted: true } };
    render(<TestProviders><SermonPage /></TestProviders>);
    expect(jest.mocked(SermonHeader).mock.calls.at(-1)![0].sermon.title).toBe('Canonical title');
    expect(jest.mocked(SermonHeader).mock.calls.at(-1)![0].editor?.isReadOnly).toBe(true);
    expect(screen.getByTestId('text-context').closest('fieldset')).toBeDisabled();
    expect(screen.queryByTestId('audio-recorder')).not.toBeInTheDocument();
    expect(screen.queryByTestId('knowledge')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('brainstorm.title')).not.toBeInTheDocument();
  });

  test('does not reconstruct an absent document from metadata or legacy query data', () => {
    mockEngineEnabled = true; mockCore.data = null; mockCore.loading = false;
    mockCore.confirmed = { ...mockCore.confirmed!, value: null, metadata: { ...mockCore.confirmed!.metadata!, deleted: true } };
    render(<TestProviders><SermonPage /></TestProviders>);
    expect(screen.queryByTestId('sermon-header')).not.toBeInTheDocument();
    expect(screen.queryByTestId('engine-scratch-workspace')).not.toBeInTheDocument();
    expect(useSermon).not.toHaveBeenCalled();
    expect(mockCore.patchCore).not.toHaveBeenCalled();
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

  test('initializes raw mode from URL param when present', async () => {
    searchParamsMock.set('mode', 'raw');
    render(
      <TestProviders>
        <SermonPage />
      </TestProviders>
    );

    await waitFor(() => {
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('sermon-abc-mode', 'raw');
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
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('sermon-abc-mode', 'prep');
    });
  });

  test('initializes raw mode from localStorage when URL param is not present', async () => {
    mockLocalStorage.getItem.mockReturnValue('raw');
    render(
      <TestProviders>
        <SermonPage />
      </TestProviders>
    );

    await waitFor(() => {
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('sermon-abc-mode', 'raw');
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

  it('opens the pinned outline form only for the enabled sermon collection', async () => {
    mockEngineEnabled = true;
    searchParamsMock = new URLSearchParams();
    const view = render(<TestProviders><SermonPage /></TestProviders>);
    fireEvent.click(await screen.findByRole('button', { name: 'planEditor.title' }));
    expect(jest.mocked(EngineOutlineModal).mock.calls.at(-1)![0]).toMatchObject({ sermonId: 'abc' });
    act(() => { jest.mocked(EngineOutlineModal).mock.calls.at(-1)![0].onClose(); });
    expect(screen.queryByTestId('engine-outline-modal')).not.toBeInTheDocument(); view.unmount();
    mockEngineEnabled = false;
    const legacy = render(<TestProviders><SermonPage /></TestProviders>);
    expect(screen.queryByTestId('engine-outline-modal')).not.toBeInTheDocument(); legacy.unmount();
  });

  it('opens the canonical form and routes direct placement/deletion to the shared document', async () => {
    mockEngineEnabled = true;
    const thought = { id: 'thought', text: 'Visible thought', tags: [], date: '2026-09-19' };
    mockCore.data = { ...mockCore.data!, thoughts: [thought] };
    searchParamsMock = new URLSearchParams();
    const view = render(<TestProviders><SermonPage /></TestProviders>);
    const list = jest.mocked(ThoughtList).mock.calls.at(-1)![0];
    expect(list.isReadOnly).toBe(false);
    const actions = jest.mocked(useSermonThoughtsDataDocument).mock.results.at(-1)!.value;
    await act(async () => { await list.onThoughtOutlinePointChange!(thought, 'point', 'sub'); });
    expect(actions.patchThought).toHaveBeenCalledWith('thought', { outlinePointId: 'point', subPointId: 'sub' });
    await act(async () => { list.onDelete('thought'); });
    expect(actions.deleteThought).toHaveBeenCalledWith('thought');
    act(() => { list.onEditStart(thought, 0); });
    expect(jest.mocked(EngineThoughtModal).mock.calls.at(-1)![0]).toMatchObject({ sermonId: 'abc', thoughtId: 'thought' });
    act(() => { jest.mocked(EngineThoughtModal).mock.calls.at(-1)![0].onClose(); });
    fireEvent.click(screen.getByRole('button', { name: 'manualThought.addManual' }));
    expect(jest.mocked(EngineThoughtModal).mock.calls.at(-1)![0]).toMatchObject({ sermonId: 'abc', thoughtId: undefined });
    view.unmount(); mockEngineEnabled = false;
  });
});
