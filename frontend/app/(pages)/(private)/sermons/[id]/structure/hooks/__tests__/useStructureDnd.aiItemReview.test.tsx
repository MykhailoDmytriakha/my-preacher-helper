import React, { useRef, useState } from 'react';
import { act, renderHook } from '@testing-library/react';

import { StructureWriterContext } from '@/components/sermon/structureWriter';
import { createEngineStructureWriter } from '@/(pages)/(private)/sermons/[id]/structure/useEngineStructureWriter';
import type { DocumentData } from '@/data-engine/types';
import type { Item, Sermon, ThoughtsBySection } from '@/models/models';

import { useStructureDnd } from '../useStructureDnd';

jest.mock('sonner');
jest.mock('@locales/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const originalIds = ['a', 'b', 'c', 'd'];
const previewIds = [...originalIds].reverse();
const sectionStructure = (main: string[]): ThoughtsBySection => ({
  introduction: [], main, conclusion: [], ambiguous: [],
});
const sermon: Sermon = {
  id: 'sermon', userId: 'owner', title: 'Review', verse: 'John 3:16', date: '2026-10-19',
  thoughts: originalIds.map((id, index) => ({
    id, text: `Authored ${id}`, tags: ['main'], date: '2026-10-19',
    outlinePointId: 'point', subPointId: null, position: (index + 1) * 1000,
  })),
  outline: { introduction: [], main: [{ id: 'point', text: 'Point' }], conclusion: [] },
  structure: sectionStructure(originalIds), thoughtsBySection: sectionStructure(originalIds),
};
const previewItems: Item[] = previewIds.map((id, index) => ({
  id, content: `Authored ${id}`, requiredTags: ['main'], customTagNames: [], outlinePointId: 'point',
  subPointId: null, position: (index + 1) * 1000,
}));

/** Real DnD hook and engine writer with a recording device-capture boundary. */
function setup() {
  let stored = JSON.parse(JSON.stringify(sermon)) as unknown as DocumentData;
  const writer = createEngineStructureWriter({
    update: async updater => { stored = updater(stored)!; },
  }, 'owner');
  const hook = renderHook(() => {
    const [screenSermon, setSermon] = useState<Sermon | null>(sermon);
    const [containers, setContainers] = useState<Record<string, Item[]>>({
      introduction: [], main: previewItems, conclusion: [], ambiguous: [],
    });
    const containersRef = useRef(containers);
    const dnd = useStructureDnd({ containers, setContainers, containersRef, sermon: screenSermon, setSermon });
    return { ...dnd, containers };
  }, {
    wrapper: ({ children }) => <StructureWriterContext.Provider value={writer}>{children}</StructureWriterContext.Provider>,
  });
  return { ...hook, saved: () => stored as unknown as Sermon };
}

describe('useStructureDnd while an AI order is awaiting review', () => {
  it('moves only the selected thought and preserves the stored relative order of unselected thoughts', async () => {
    const hook = setup();

    act(() => { hook.result.current.handleDragStart({ active: { id: 'b' } } as never); });
    await act(async () => {
      await hook.result.current.handleDragEnd({
        active: { id: 'b' },
        over: { id: 'a', data: { current: { container: 'main', outlinePointId: 'point', subPointId: null } } },
      } as never);
    });

    // The one intentional move is B to the end. Applying that move to stored A,B,C,D
    // yields A,C,D,B; preview order D,C,B,A must not become the baseline for others.
    expect(hook.saved().structure?.main).toEqual(['a', 'c', 'd', 'b']);
  });
});
