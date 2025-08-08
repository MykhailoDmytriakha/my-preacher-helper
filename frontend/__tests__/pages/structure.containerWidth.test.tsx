import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';

// i18n
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
  }),
}));

// next/navigation
jest.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: () => 'sermon-1' }),
}));

// Heavy deps mocks
jest.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: any) => <div>{children}</div>,
  DragOverlay: ({ children }: any) => <div>{children}</div>,
  pointerWithin: jest.fn(),
  useDroppable: () => ({ setNodeRef: jest.fn(), isOver: false }),
  useSensors: (...args: any[]) => args,
  useSensor: (...args: any[]) => args[0],
  PointerSensor: function PointerSensor() {},
  KeyboardSensor: function KeyboardSensor() {},
}));
jest.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: any) => <div>{children}</div>,
  rectSortingStrategy: jest.fn(),
  verticalListSortingStrategy: jest.fn(),
  sortableKeyboardCoordinates: jest.fn(),
}));

jest.mock('@/hooks/useSermonStructureData', () => ({
  useSermonStructureData: () => ({
    sermon: { id: 'sermon-1', title: 'T', thoughts: [] },
    setSermon: jest.fn(),
    containers: { introduction: [], main: [], conclusion: [], ambiguous: [] },
    setContainers: jest.fn(),
    outlinePoints: { introduction: [], main: [], conclusion: [] },
    requiredTagColors: {},
    allowedTags: [],
    loading: false,
    error: null,
    setLoading: jest.fn(),
    isAmbiguousVisible: true,
    setIsAmbiguousVisible: jest.fn(),
  }),
}));

jest.mock('@/components/Column', () => () => <div data-testid="col" />);
jest.mock('@/components/SortableItem', () => () => <div data-testid="item" />);

import StructurePage from '@/(pages)/(private)/structure/page';

describe('Structure container width', () => {
  it('uses full width without max-w wrapper', () => {
    const { container } = render(<StructurePage />);
    expect(container.querySelector('.max-w-7xl')).toBeNull();
    const wrapper = container.querySelector('div.min-h-screen');
    expect(wrapper).toBeTruthy();
    const inner = Array.from(container.querySelectorAll('div')).find((el) =>
      el.className.includes('w-full')
    );
    expect(inner).toBeTruthy();
  });
});


