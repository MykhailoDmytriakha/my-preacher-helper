import { render } from '@testing-library/react';
import React from 'react';

import { OutlinePointCard } from '@/components/column/OutlinePointCard';
import SortableItem from '@/components/SortableItem';

import type { Item } from '@/models/models';

jest.mock('@dnd-kit/core', () => ({ useDroppable: () => ({ setNodeRef: () => undefined, isOver: false }) }));
jest.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: React.PropsWithChildren) => <>{children}</>,
  verticalListSortingStrategy: jest.fn(),
  useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: () => undefined, transform: null, transition: null, isDragging: false }),
}));
jest.mock('@/services/thought.service', () => ({ createAudioThought: jest.fn() }));
jest.mock('@/components/column/SubPointList', () => ({ SubPointList: () => null }));
jest.mock('@/components/FocusRecorderButton', () => ({ FocusRecorderButton: () => null }));
jest.mock('@/components/FlatRecorderButton', () => ({ FlatRecorderButton: () => null }));

const t = (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key);
const thought = (id: string): Item => ({ id, content: `Thought ${id}`, customTagNames: [], outlinePointId: 'point' });

// Tailwind's unnamed `group-hover:` fires when ANY ancestor with the `group` class is hovered.
// A thought card sits inside a plan point card; if both are unnamed groups, hovering the point
// reveals the hover-only buttons of every thought in it. A hover affordance must answer to one group.
// Read the class attribute, not className: on an SVG icon className is an object, not a string.
const classesOf = (element: Element) => (element.getAttribute('class') ?? '').split(/\s+/);
const unnamedGroupHoverUnderNestedGroups = (root: HTMLElement) =>
  Array.from(root.querySelectorAll('[class*="group-hover:"]'))
    .filter((element) => classesOf(element).some((name) => /(^|:)group-hover:/.test(name)))
    .filter((element) => {
      let groups = 0;
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (classesOf(ancestor).includes('group')) groups += 1;
      }
      return groups > 1;
    })
    .map((element) => (element.getAttribute('class') ?? '').slice(0, 60));

it.each([false, true])('hovering a plan point reveals nothing that belongs to one of its thoughts (focus=%s)', (isFocusMode) => {
  const items = [thought('first'), thought('second')];
  const { container } = render(
    <OutlinePointCard
      point={{ id: 'point', text: 'Point' }}
      pointItems={items}
      containerId="main"
      t={t}
      isOnline
      isFocusMode={isFocusMode}
      setAudioError={jest.fn()}
      onClearAudioError={jest.fn()}
      onTogglePointLock={jest.fn()}
      renderItem={(item) => (
        <SortableItem key={item.id} item={item} containerId="main" onEdit={jest.fn()} onMoveToAmbiguous={jest.fn()} onToggleLock={jest.fn()} />
      )}
    />
  );
  expect(container.querySelectorAll('[data-testid^="sortable-item-actions-"]')).toHaveLength(2);
  expect(unnamedGroupHoverUnderNestedGroups(container)).toEqual([]);
});
