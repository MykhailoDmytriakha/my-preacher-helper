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
  let mockRetryThoughtSave: jest.Mock;
  let defaultProps: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSetSermon = jest.fn();
    mockSetContainers = jest.fn();
    mockRetryThoughtSave = jest.fn();

    defaultProps = {
      sermon: createMockSermon({ id: 'sermon-1' }),
      setSermon: mockSetSermon,
      containers: { introduction: [], main: [], conclusion: [], ambiguous: [] },
      setContainers: mockSetContainers,
      containersRef: { current: { introduction: [], main: [], conclusion: [], ambiguous: [] } },
      allowedTags: [{ name: 'test', color: '#000' }],
      debouncedSaveThought: jest.fn(),
      debouncedSaveStructure: jest.fn(),
      retryThoughtSave: mockRetryThoughtSave,
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

  it('handleSaveEdit cancels creation if text is empty for a new temp thought', async () => {
    const { result } = renderHook(() => useSermonActions(defaultProps));
    act(() => { result.current.handleAddThoughtToSection('introduction'); });
    await act(async () => { await result.current.handleSaveEdit('', []); });
    expect(result.current.editingItem).toBeNull();
    expect(thoughtService.createManualThought).not.toHaveBeenCalled();
  });

  it('handleSaveEdit deletes an existing thought if text is empty', async () => {
    const existingThought = createMockThought({ id: 't1', text: 'Original' });
    const existingItem = createMockItem({ id: 't1', content: 'Original' });

    defaultProps.sermon = createMockSermon({ id: 'sermon-1', thoughts: [existingThought] });
    defaultProps.containers.introduction = [existingItem];
    defaultProps.containersRef = { current: { ...defaultProps.containers } };

    const { result } = renderHook(() => useSermonActions(defaultProps));
    act(() => { result.current.handleEdit(existingItem); });
    await act(async () => { await result.current.handleSaveEdit('  ', []); });

    expect(thoughtService.deleteThought).toHaveBeenCalled();
  });

  it('handleSaveEdit creates a new thought optimistically when saving a temp item', async () => {
    (thoughtService.createManualThought as jest.Mock).mockResolvedValueOnce({
      id: 'server-123', text: 'new text', tags: [], date: new Date().toISOString()
    });

    const { result } = renderHook(() => useSermonActions(defaultProps));

    act(() => { result.current.handleAddThoughtToSection('introduction'); });
    await act(async () => { await result.current.handleSaveEdit('new text', ['tag1']); });

    // The thought is created with a client-minted id (not a "local-" placeholder).
    expect(thoughtService.createManualThought).toHaveBeenCalledWith(
      'sermon-1',
      expect.objectContaining({ text: 'new text', tags: ['tag1'] }),
    );
    const createdArg = (thoughtService.createManualThought as jest.Mock).mock.calls[0][1];
    expect(createdArg.id).not.toMatch(/^local-/);
    // Optimistic cache + container writes happened.
    expect(mockSetSermon).toHaveBeenCalled();
    expect(mockSetContainers).toHaveBeenCalled();
    expect(result.current.editingItem).toBeNull();
  });

  it('preserves subPointId in the UI item when saving a new thought into a sub-point', async () => {
    defaultProps.sermon = createMockSermon({
      id: 'sermon-1',
      outline: {
        introduction: [],
        main: [
          {
            id: 'op-1',
            text: 'Main point',
            subPoints: [{ id: 'sp-1', text: 'Sub-point 1', position: 1000 }],
          },
        ],
        conclusion: [],
      },
    });
    (thoughtService.createManualThought as jest.Mock).mockResolvedValueOnce({
      id: 'server-123',
      text: 'new text',
      tags: [],
      date: new Date().toISOString(),
      outlinePointId: 'op-1',
      subPointId: 'sp-1',
    });

    const { result } = renderHook(() => useSermonActions(defaultProps));

    act(() => { result.current.handleAddThoughtToSection('main'); });
    await act(async () => {
      await result.current.handleSaveEdit('new text', ['tag1'], 'op-1', 'sp-1');
    });

    expect(thoughtService.createManualThought).toHaveBeenCalledWith(
      'sermon-1',
      expect.objectContaining({
        outlinePointId: 'op-1',
        subPointId: 'sp-1',
      }),
    );

    // The optimistic UI item added to the container carries the sub-point id.
    const firstUpdater = mockSetContainers.mock.calls[0][0];
    const nextContainers = firstUpdater({ introduction: [], main: [], conclusion: [], ambiguous: [] });
    const addedItem = nextContainers.main.find((it: any) => it.subPointId === 'sp-1');
    expect(addedItem).toBeTruthy();
    expect(addedItem.outlinePointId).toBe('op-1');
  });

  it('handleSaveEdit updates an existing thought', async () => {
    const existingThought = createMockThought({ id: 't1', text: 'Old' });
    const existingItem = createMockItem({ id: 't1', content: 'Old' });

    defaultProps.sermon = createMockSermon({ id: 'sermon-1', thoughts: [existingThought] });
    defaultProps.containers.introduction = [existingItem];
    defaultProps.containersRef = { current: { ...defaultProps.containers } };

    (thoughtService.updateThought as jest.Mock).mockResolvedValueOnce({ ...existingThought, text: 'New' });

    const { result } = renderHook(() => useSermonActions(defaultProps));

    act(() => { result.current.handleEdit(existingItem); });
    await act(async () => { await result.current.handleSaveEdit('New', ['tag1']); });

    expect(thoughtService.updateThought).toHaveBeenCalled();
    expect(mockSetSermon).toHaveBeenCalled();
    expect(mockSetContainers).toHaveBeenCalled();
    expect(result.current.editingItem).toBeNull();
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

  it('handleRetryPendingThought re-fires the debounced thought save', async () => {
    const { result } = renderHook(() => useSermonActions(defaultProps));

    await act(async () => { await result.current.handleRetryPendingThought('t-2'); });

    expect(mockRetryThoughtSave).toHaveBeenCalledWith('t-2');
  });
});
