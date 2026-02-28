import { renderHook, act } from '@testing-library/react';
import { useSermonActions } from '@/(pages)/(private)/sermons/[id]/structure/hooks/useSermonActions';
import * as thoughtService from '@/services/thought.service';
import { createMockSermon, createMockItem, createMockThought } from '../../test-utils/structure-test-utils';

jest.mock('@/services/thought.service', () => ({
  deleteThought: jest.fn(),
  updateThought: jest.fn(),
  createManualThought: jest.fn(),
}));
jest.mock('@/services/structure.service');
jest.mock('sonner');
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));
jest.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));

describe('useSermonActions', () => {
  let mockSetSermon: jest.Mock;
  let mockSetContainers: jest.Mock;
  let mockPendingActions: any;
  let defaultProps: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSetSermon = jest.fn();
    mockSetContainers = jest.fn();

    mockPendingActions = {
      createPendingThought: jest.fn(),
      updatePendingThought: jest.fn(),
      markPendingStatus: jest.fn(),
      removePendingThought: jest.fn(),
      replacePendingThought: jest.fn(),
      updateItemSyncStatus: jest.fn(),
      getPendingById: jest.fn(),
    };

    defaultProps = {
      sermon: createMockSermon({ id: 'sermon-1' }),
      setSermon: mockSetSermon,
      containers: { introduction: [], main: [], conclusion: [], ambiguous: [] },
      setContainers: mockSetContainers,
      containersRef: { current: { introduction: [], main: [], conclusion: [], ambiguous: [] } },
      allowedTags: [{ name: 'test', color: '#000' }],
      debouncedSaveThought: jest.fn(),
      debouncedSaveStructure: jest.fn(),
      pendingActions: mockPendingActions,
    };
  });

  it('handleEdit and handleCloseEdit work correctly', () => {
    const { result } = renderHook(() => useSermonActions(defaultProps));
    const item = createMockItem({ id: 't1' });

    act(() => { result.current.handleEdit(item); });
    expect(result.current.editingItem).toEqual(item);

    act(() => { result.current.handleCloseEdit(); });
    expect(result.current.editingItem).toBeNull();
  });

  // Empty cases test omitted for brevity initially but they were working. Let's include them.
  it('handleSaveEdit cancels creation if text is empty for a new temp thought', async () => {
    const { result } = renderHook(() => useSermonActions(defaultProps));
    act(() => { result.current.handleAddThoughtToSection('introduction'); });
    await act(async () => { await result.current.handleSaveEdit('', []); });
    expect(result.current.editingItem).toBeNull();
  });

  it('handleSaveEdit deletes an existing thought if text is empty', async () => {
    const existingThought = createMockThought({ id: 't1', text: 'Original' });
    const existingItem = createMockItem({ id: 't1', content: 'Original' });

    defaultProps.sermon = createMockSermon({ id: 'sermon-1', thoughts: [existingThought] });
    defaultProps.containers.introduction = [existingItem];

    const { result } = renderHook(() => useSermonActions(defaultProps));
    act(() => { result.current.handleEdit(existingItem); });
    await act(async () => { await result.current.handleSaveEdit('  ', []); });

    expect(thoughtService.deleteThought).toHaveBeenCalled();
  });

  it('handleSaveEdit creates a new thought when saving temp item', async () => {
    mockPendingActions.createPendingThought.mockReturnValue({ localId: 'local-123' });
    (thoughtService.createManualThought as jest.Mock).mockResolvedValueOnce({
      id: 'server-123', text: 'new text', tags: [], date: new Date().toISOString()
    });

    const { result } = renderHook(() => useSermonActions(defaultProps));

    act(() => { result.current.handleAddThoughtToSection('introduction'); });
    await act(async () => { await result.current.handleSaveEdit('new text', ['tag1']); });

    expect(mockPendingActions.createPendingThought).toHaveBeenCalled();
    expect(mockPendingActions.markPendingStatus).toHaveBeenCalledWith('local-123', 'sending', expect.any(Object));
    expect(thoughtService.createManualThought).toHaveBeenCalled();
    expect(mockPendingActions.replacePendingThought).toHaveBeenCalled();
    expect(mockSetSermon).toHaveBeenCalled();
  });

  it('handleSaveEdit updates an existing thought', async () => {
    const existingThought = createMockThought({ id: 't1', text: 'Old' });
    const existingItem = createMockItem({ id: 't1', content: 'Old' });

    defaultProps.sermon = createMockSermon({ id: 'sermon-1', thoughts: [existingThought] });
    defaultProps.containers.introduction = [existingItem];

    (thoughtService.updateThought as jest.Mock).mockResolvedValueOnce({ ...existingThought, text: 'New' });

    const { result } = renderHook(() => useSermonActions(defaultProps));

    act(() => { result.current.handleEdit(existingItem); });
    await act(async () => { await result.current.handleSaveEdit('New', ['tag1']); });

    expect(thoughtService.updateThought).toHaveBeenCalled();
    expect(mockSetSermon).toHaveBeenCalled();
    expect(mockSetContainers).toHaveBeenCalled();
    expect(result.current.editingItem).toBeNull();
  });

  it('handleSaveEdit updates a pending thought', async () => {
    const localItem = createMockItem({ id: 'local-1' });
    defaultProps.sermon = createMockSermon({ id: 'sermon-1', thoughts: [] });

    mockPendingActions.getPendingById.mockReturnValue({ sectionId: 'main', text: 'Old', tags: [] });
    (thoughtService.createManualThought as jest.Mock).mockResolvedValueOnce({
      id: 'server-1', text: 'New', tags: []
    });

    const { result } = renderHook(() => useSermonActions(defaultProps));

    act(() => { result.current.handleEdit(localItem); });
    await act(async () => { await result.current.handleSaveEdit('New', []); });

    expect(mockPendingActions.updatePendingThought).toHaveBeenCalledWith('local-1', expect.any(Object));
    expect(thoughtService.createManualThought).toHaveBeenCalled();
  });

  it('handleMoveToAmbiguous moves item to ambiguous container', () => {
    const itemToMove = createMockItem({ id: 't1', content: 'hello' });
    defaultProps.sermon = createMockSermon({ id: 'sermon-1', thoughts: [createMockThought({ id: 't1' })] });
    defaultProps.containers.main = [itemToMove];

    const { result } = renderHook(() => useSermonActions(defaultProps));

    act(() => { result.current.handleMoveToAmbiguous('t1', 'main'); });

    expect(mockSetContainers).toHaveBeenCalledWith(expect.objectContaining({
      main: [],
      ambiguous: [expect.objectContaining({ id: 't1', outlinePointId: null })]
    }));
    expect(defaultProps.debouncedSaveThought).toHaveBeenCalled();
    expect(defaultProps.debouncedSaveStructure).toHaveBeenCalled();
  });

  it('handleRetryPendingThought calls submitPendingThought', async () => {
    mockPendingActions.getPendingById.mockReturnValue({ sectionId: 'conclusion', text: 'retry', tags: [] });
    const { result } = renderHook(() => useSermonActions(defaultProps));

    await act(async () => { await result.current.handleRetryPendingThought('local-2'); });

    expect(mockPendingActions.getPendingById).toHaveBeenCalledWith('local-2');
    expect(mockPendingActions.markPendingStatus).toHaveBeenCalledWith('local-2', 'sending', expect.any(Object));
    expect(thoughtService.createManualThought).toHaveBeenCalled();
  });
});
