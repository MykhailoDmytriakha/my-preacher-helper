import { render } from '@testing-library/react';
import React from 'react';

import type { Sermon } from '@/models/models';
import '@testing-library/jest-dom';

/**
 * THE LIST MUST NOT JERK WHEN A POINT IS DROPPED (BUG-20260927-outline-dnd-spacing-late-snap).
 *
 * Measured in a real browser: the drag placeholder copied the margins of the slot it was lifted
 * from, so with `space-y-2` on the list a point dropped at the end moved the list below by 8px.
 * Layout cannot be measured here, so this test holds the construction that prevents it. (The other
 * jerk on wide screens, from the hover-only add-sub-point row, is BUG-20261004-outline-hover-row-jerk.)
 */

jest.mock('@hello-pangea/dnd', () => ({
  DragDropContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Droppable: ({ children, droppableId }: { children: (provided: unknown) => React.ReactNode; droppableId: string }) =>
    children({ innerRef: jest.fn(), droppableProps: { 'data-rfd-droppable-id': droppableId }, placeholder: null }),
  Draggable: ({ children, draggableId }: { children: (provided: unknown, snapshot: unknown) => React.ReactNode; draggableId: string }) =>
    children({ innerRef: jest.fn(), draggableProps: { 'data-rfd-draggable-id': draggableId }, dragHandleProps: {} }, { isDragging: false }),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/providers/ConnectionProvider', () => ({
  useConnection: () => ({ isOnline: true, isMagicAvailable: true, checkConnection: jest.fn() }),
  ConnectionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('@/services/outline.service', () => ({
  getSermonOutline: jest.fn(),
  updateSermonOutline: jest.fn(async (_id: string, outline: unknown) => outline),
}));

import SermonOutline from '@/components/sermon/SermonOutline';

const sermon: Sermon = {
  id: 'sermon-1', title: 'Sermon', userId: 'user-1', verse: 'John 1:1', date: '2026-10-01T00:00:00.000Z', thoughts: [],
  outline: {
    introduction: [{ id: 'intro1', text: 'Opening' }],
    main: [{ id: 'main1', text: 'First point' }, { id: 'main2', text: 'Second point' }],
    conclusion: [{ id: 'concl1', text: 'Closing' }],
  },
};

const pointRow = (container: HTMLElement, id: string) => container.querySelector(`[data-rfd-draggable-id="${id}"]`) as HTMLElement;

describe('SermonOutline drop layout', () => {
  it('carries the gap on each point, not on the list the placeholder joins', () => {
    const { container } = render(<SermonOutline sermon={sermon} />);

    const lists = [...container.querySelectorAll('[data-rfd-droppable-id]')] as HTMLElement[];
    expect(lists).toHaveLength(3);
    lists.forEach((list) => expect(list.className).not.toMatch(/space-y-/));
    ['intro1', 'main1', 'main2', 'concl1'].forEach((id) => expect(pointRow(container, id)).toHaveClass('mb-2'));
  });
});
