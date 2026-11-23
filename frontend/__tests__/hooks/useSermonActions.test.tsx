import { renderHook as rtlRenderHook, act } from '@testing-library/react';
import React from 'react';

import { StructureWriterContext, type StructureWriter } from '@/components/sermon/structureWriter';
import { useSermonActions } from '@/(pages)/(private)/sermons/[id]/structure/hooks/useSermonActions';
import { createMockSermon, createMockItem, createMockThought } from '../../test-utils/structure-test-utils';

jest.mock('sonner');
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));
jest.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));

/** Every write the hook makes goes through the structure writer; these are its recording stand-ins. */
const thoughtService = {
  deleteThought: jest.fn(),
  updateThought: jest.fn(),
  createManualThought: jest.fn(),
};
const mockWriter: StructureWriter = {
  updateStructure: jest.fn().mockResolvedValue({}),
  ...thoughtService,
  updateSermonOutline: jest.fn(),
};

const renderHook = <T,>(callback: () => T) =>
  rtlRenderHook(callback, {
    wrapper: ({ children }) =>
      React.createElement(StructureWriterContext.Provider, { value: mockWriter }, children),
  });

describe('useSermonActions', () => {
  let mockSetSermon: jest.Mock;
  let mockSetContainers: jest.Mock;
  let defaultProps: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSetSermon = jest.fn();
    mockSetContainers = jest.fn();

    defaultProps = {
      sermon: createMockSermon({ id: 'sermon-1' }),
      setSermon: mockSetSermon,
      containers: { introduction: [], main: [], conclusion: [], ambiguous: [] },
      setContainers: mockSetContainers,
      containersRef: { current: { introduction: [], main: [], conclusion: [], ambiguous: [] } },
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

  it('handleMoveToAmbiguous moves item to ambiguous container', async () => {
    const itemToMove = createMockItem({ id: 't1', content: 'hello' });
    defaultProps.sermon = createMockSermon({ id: 'sermon-1', thoughts: [createMockThought({ id: 't1' })] });
    defaultProps.containers.main = [itemToMove];

    const { result } = renderHook(() => useSermonActions(defaultProps));

    await act(async () => { await result.current.handleMoveToAmbiguous('t1', 'main'); });

    expect(mockSetContainers).toHaveBeenCalledWith(expect.objectContaining({
      main: [],
      ambiguous: [expect.objectContaining({ id: 't1', outlinePointId: null })]
    }));
    expect(mockWriter.updateStructure).toHaveBeenCalledWith(
      'sermon-1', expect.objectContaining({ main: [], ambiguous: ['t1'] }), defaultProps.sermon.structure,
      expect.objectContaining({ thoughtIds: ['t1'], thoughtUpdates: [expect.objectContaining({
        thought: expect.objectContaining({ id: 't1', outlinePointId: null, subPointId: null }),
        baseThought: expect.objectContaining({ id: 't1' }),
      })] }),
    );
  });

});
