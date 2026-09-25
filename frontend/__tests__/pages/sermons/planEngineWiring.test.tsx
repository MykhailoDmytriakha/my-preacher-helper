import { act, renderHook } from '@testing-library/react';
import React from 'react';

import { useManualConspectus } from '@/(pages)/(private)/sermons/[id]/plan/manual/useManualConspectus';
import { PlanWriterContext, type PlanWriter } from '@/(pages)/(private)/sermons/[id]/plan/planWriter';
import { savePlanModeViaClient, savePlanTextViaClient } from '@/services/sermons.client';

import type { Sermon } from '@/models/models';

jest.mock('@/services/sermons.client', () => ({
  ...jest.requireActual('@/services/sermons.client'),
  savePlanTextViaClient: jest.fn(),
  savePlanModeViaClient: jest.fn(),
}));
jest.mock('@/utils/debugMode', () => ({ debugLog: jest.fn() }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));

const sermon = {
  id: 'sermon-1', userId: 'user-1', title: 'Grace', verse: '', date: '2026-01-01', thoughts: [],
  outline: { introduction: [{ id: 'p1', text: 'First point' }], main: [], conclusion: [] },
  planText: { p1: 'Stored text' },
} as unknown as Sermon;

describe('the hand-written plan on the engine', () => {
  it('saves a cell through the engine plan writer, with the baseline it opened with, and never the legacy writer', async () => {
    const writer: PlanWriter = {
      savePlanText: jest.fn().mockResolvedValue(undefined),
      savePlanMode: jest.fn().mockResolvedValue(undefined),
      updateThought: jest.fn(),
      updateSermonOutline: jest.fn(),
    };
    const wrapper = ({ children }: { children: React.ReactNode }) => <PlanWriterContext.Provider value={writer}>{children}</PlanWriterContext.Provider>;
    const { result } = renderHook(() => useManualConspectus({ sermon, setSermon: jest.fn(), t: ((key: string) => key) as never }), { wrapper });
    act(() => { result.current.setNodeContent('p1', 'Typed here'); });
    await act(async () => { await result.current.savePoint('p1', 'introduction', ['p1']); });
    expect(writer.savePlanText).toHaveBeenCalledWith('sermon-1', { p1: 'Typed here' }, expect.any(Array),
      expect.objectContaining({ baselineByNodeId: { p1: 'Stored text' } }));
    expect(savePlanTextViaClient).not.toHaveBeenCalled();
    expect(savePlanModeViaClient).not.toHaveBeenCalled();
  });
});
