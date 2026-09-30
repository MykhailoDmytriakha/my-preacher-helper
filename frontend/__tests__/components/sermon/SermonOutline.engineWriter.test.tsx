import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';

import { createEngineStructureWriter } from '@/(pages)/(private)/sermons/[id]/structure/useEngineStructureWriter';
import SermonOutline from '@/components/sermon/SermonOutline';
import { StructureWriterContext } from '@/components/sermon/structureWriter';

import type { DocumentData } from '@/data-engine/types';
import type { Sermon } from '@/models/models';

/**
 * BUG-20260929-engine-outline-read-only. On an engine document the sermon page rendered this panel
 * read-only, because its only writer was the legacy service that refuses engine documents: the
 * pencil did nothing and "Add point" was greyed out. The panel now writes through the structure
 * writer in context; on the engine that is the same writer the structure screen uses.
 *
 * The legacy service here refuses like production does, so any write that slips past the context
 * writer fails the test instead of passing silently.
 */
jest.mock('@/services/outline.service', () => ({
  updateSermonOutline: jest.fn(async () => { throw new Error('data-engine-required'); }),
  generateSermonPointsForSection: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@hello-pangea/dnd', () => ({
  DragDropContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Droppable: ({ children }: { children: any }) =>
    children({ innerRef: jest.fn(), droppableProps: {}, placeholder: null }),
  Draggable: ({ children }: { children: any }) =>
    children(
      { innerRef: jest.fn(), draggableProps: {}, dragHandleProps: {} },
      { isDragging: false, isDropAnimating: false, draggingOver: null }
    ),
}));

jest.mock('@/utils/themeColors', () => ({
  ...jest.requireActual('@/utils/themeColors'),
  getSectionStyling: () => ({ headerBg: '', headerHover: '', border: '', dragBg: '', badge: '' }),
}));

jest.mock('@/providers/ConnectionProvider', () => ({
  useConnection: () => ({ isOnline: true, isMagicAvailable: true, checkConnection: jest.fn() }),
  ConnectionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const OWNER = 'u1';

/** The engine document's current copy: what every write is laid over. */
let documentCopy: Sermon;
const fakeDocument = {
  update: jest.fn(async (fn: (current: DocumentData | null) => DocumentData | null) => {
    documentCopy = fn(documentCopy as unknown as DocumentData) as unknown as Sermon;
  }),
};

const renderPanel = (sermon: Sermon) => {
  const writer = createEngineStructureWriter(fakeDocument, OWNER);
  const view = render(
    <StructureWriterContext.Provider value={writer}>
      <SermonOutline sermon={sermon} />
    </StructureWriterContext.Provider>
  );
  return {
    ...view,
    rerenderWith: (next: Sermon) => view.rerender(
      <StructureWriterContext.Provider value={writer}>
        <SermonOutline sermon={next} />
      </StructureWriterContext.Provider>
    ),
  };
};

const introSection = () => screen.getByText('structure.introduction').closest('div')!.parentElement as HTMLElement;

describe('the sermon page outline on an engine document', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    documentCopy = {
      id: 's1', title: 'Sermon', verse: '', date: '', userId: OWNER,
      outline: { introduction: [{ id: 'p1', text: 'First impression' }], main: [], conclusion: [] },
      thoughts: [{ id: 't1', text: 'Thought', tags: ['intro'], date: '', outlinePointId: 'p1' }],
    } as unknown as Sermon;
  });

  it('adds a point through the engine writer', async () => {
    renderPanel(documentCopy);
    const addButton = within(introSection()).getByLabelText('structure.addPointButton');
    expect(addButton).toBeEnabled();
    await act(async () => { fireEvent.click(addButton); });
    const input = screen.getByPlaceholderText('structure.addPointPlaceholder');
    fireEvent.change(input, { target: { value: 'Proverbs as a prism' } });
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' }); });

    await waitFor(() => expect(documentCopy.outline!.introduction.map(point => point.text))
      .toEqual(['First impression', 'Proverbs as a prism']));
    expect(screen.getByText('Proverbs as a prism')).toBeInTheDocument();
  });

  it('renames a point with the pencil through the engine writer', async () => {
    renderPanel(documentCopy);
    await act(async () => { fireEvent.click(within(introSection()).getByLabelText('common.edit')); });
    const input = screen.getByDisplayValue('First impression');
    fireEvent.change(input, { target: { value: 'A first impression' } });
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' }); });

    await waitFor(() => expect(documentCopy.outline!.introduction[0]).toMatchObject({ id: 'p1', text: 'A first impression' }));
  });

  it('releases the thoughts of a deleted point in the same write', async () => {
    renderPanel(documentCopy);
    await act(async () => { fireEvent.click(within(introSection()).getByLabelText('common.delete')); });
    // The confirmation dialog adds a second "delete" button; it is the last one.
    const deleteButtons = await screen.findAllByRole('button', { name: 'common.delete' });
    expect(deleteButtons.length).toBeGreaterThan(1);
    await act(async () => { fireEvent.click(deleteButtons.at(-1)!); });

    await waitFor(() => expect(documentCopy.outline!.introduction).toEqual([]));
    expect(documentCopy.thoughts[0].outlinePointId ?? null).toBeNull();
    expect(fakeDocument.update).toHaveBeenCalledTimes(1);
  });

  it('follows the document again once its own save has settled', async () => {
    const { rerenderWith } = renderPanel(documentCopy);
    const addButton = within(introSection()).getByLabelText('structure.addPointButton');
    await act(async () => { fireEvent.click(addButton); });
    const input = screen.getByPlaceholderText('structure.addPointPlaceholder');
    fireEvent.change(input, { target: { value: 'Mine' } });
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' }); });
    await waitFor(() => expect(fakeDocument.update).toHaveBeenCalledTimes(1));

    // Another device adds a point; the engine delivers the new copy to the page.
    documentCopy = { ...documentCopy, outline: { ...documentCopy.outline!,
      introduction: [...documentCopy.outline!.introduction, { id: 'remote', text: 'From the phone' }] } };
    rerenderWith(documentCopy);
    expect(await screen.findByText('From the phone')).toBeInTheDocument();
  });
});
