import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock i18n once for these tests
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue || key }),
}));

// Minimal mocks for heavy deps used in various pages
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

// Mock router hooks per page
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'sermon-1' }),
  useRouter: () => ({ push: jest.fn(), prefetch: jest.fn() }),
  useSearchParams: () => ({ get: () => 'sermon-1' }),
  usePathname: () => '/dashboard',
}));

// Mock services/hooks heavy calls
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

// Light stubs
jest.mock('@/components/Column', () => () => <div data-testid="col" />);
jest.mock('@/components/SortableItem', () => () => <div data-testid="item" />);

// Import pages directly
import DashboardPage from '@/(pages)/(private)/dashboard/page';
import SermonDetailPage from '@/(pages)/(private)/sermons/[id]/page';
import SermonPlanPage from '@/(pages)/(private)/sermons/[id]/plan/page';
import StructurePage from '@/(pages)/(private)/structure/page';
import SettingsPage from '@/(pages)/(private)/settings/page';

// Helper that asserts private page does not add global shell classes
function expectNoPageLevelShell(container: HTMLElement) {
  expect(container.querySelector('.min-h-screen')).toBeNull();
  const hasLayoutContainer = Array.from(container.querySelectorAll('div')).some((el) =>
    el.className.includes('mx-auto') && el.className.includes('px-4') && el.className.includes('lg:px-8')
  );
  expect(hasLayoutContainer).toBe(false);
}

describe('Private pages adhere to single-shell policy', () => {
  const cases: Array<[string, React.ComponentType<any>]> = [
    ['dashboard', DashboardPage],
    ['sermons/[id]', SermonDetailPage],
    ['sermons/[id]/plan', SermonPlanPage],
    ['structure', StructurePage],
    ['settings', SettingsPage],
  ];

  it.each(cases)('page %s does not add page-level shell wrappers', (_name, PageComp) => {
    const { container } = render(<PageComp />);
    expectNoPageLevelShell(container);
  });
});


