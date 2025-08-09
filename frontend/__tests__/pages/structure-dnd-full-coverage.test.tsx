import { DragEndEvent } from '@dnd-kit/core';

// Local types for test clarity
interface TestItem {
  id: string;
  content: string;
  requiredTags: string[];
  customTagNames: Array<{ name: string; color?: string }>;
  outlinePointId?: string | null;
}

interface TestContainers {
  ambiguous: TestItem[];
  introduction: TestItem[];
  main: TestItem[];
  conclusion: TestItem[];
}

// Common mocks
jest.mock('@/services/structure.service', () => ({
  updateStructure: jest.fn(),
}));

jest.mock('@/services/thought.service', () => ({
  updateThought: jest.fn(),
}));

jest.mock('lodash/debounce', () =>
  jest.fn((fn) => {
    const debouncedFn = (...args: any[]) => fn(...args);
    debouncedFn.cancel = jest.fn();
    debouncedFn.flush = jest.fn();
    return debouncedFn;
  })
);

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_: string, opts?: any) => opts?.defaultValue || _,
  }),
}));

describe('Structure DnD full coverage: moving across sections and outline points', () => {
  const sermon = {
    id: 'sermon-1',
    title: 'Test',
    thoughts: [
      { id: 't1', text: 'A', tags: [], outlinePointId: 'intro-1' },
      { id: 't2', text: 'B', tags: [], outlinePointId: 'main-1' },
      { id: 't3', text: 'C', tags: [], outlinePointId: null },
    ],
    outline: {
      introduction: [{ id: 'intro-1', text: 'Intro Point 1' }],
      main: [{ id: 'main-1', text: 'Main Point 1' }],
      conclusion: [{ id: 'conclusion-1', text: 'Conclusion Point 1' }],
    },
  };

  const columnTitles: Record<string, string> = {
    introduction: 'Introduction',
    main: 'Main Part',
    conclusion: 'Conclusion',
    ambiguous: 'Under Consideration',
  };

  const move = async (
    containers: TestContainers,
    event: DragEndEvent,
    setContainers: jest.Mock
  ) => {
    const { active, over } = event;
    if (!over) return;

    // Discover source container by scanning
    const activeContainer = (Object.keys(containers) as Array<keyof TestContainers>).find(
      (k) => containers[k].some((i) => i.id === active.id)
    ) as keyof TestContainers | undefined;

    let overContainer = (over.data?.current as any)?.container as keyof TestContainers | undefined;
    let outlinePointId = (over.data?.current as any)?.outlinePointId as string | null | undefined;

    if (String(over.id).startsWith('outline-point-')) {
      outlinePointId = String(over.id).replace('outline-point-', '');
      overContainer = (over.data?.current as any)?.container;
    } else if (String(over.id).startsWith('unassigned-')) {
      outlinePointId = null;
      overContainer = (over.data?.current as any)?.container;
    } else if (over.id === 'dummy-drop-zone') {
      overContainer = 'ambiguous' as keyof TestContainers;
    } else if (!overContainer) {
      overContainer = over.id as keyof TestContainers;
    }

    if (!activeContainer || !overContainer) return;

    let updated = { ...containers } as TestContainers;
    if (activeContainer !== overContainer) {
      const src = [...updated[activeContainer]];
      const dst = [...updated[overContainer]];
      const idx = src.findIndex((i) => i.id === active.id);
      if (idx !== -1) {
        const [dragged] = src.splice(idx, 1);
        dst.push(dragged);
        updated[activeContainer] = src;
        updated[overContainer] = dst;
      }
    }

    // Required tags for destination section
    let updatedRequiredTags: string[] = [];
    if (['introduction', 'main', 'conclusion'].includes(String(overContainer))) {
      updatedRequiredTags = [columnTitles[overContainer]];
    }

    // Compute final outline point id according to rules
    let finalOutlinePointId: string | undefined = undefined;
    if (typeof outlinePointId === 'string') finalOutlinePointId = outlinePointId;
    else if (outlinePointId === null) finalOutlinePointId = undefined;
    else {
      const targetItem = updated[overContainer].find((i) => i.id === active.id);
      finalOutlinePointId = targetItem?.outlinePointId ?? undefined;
      if (activeContainer !== overContainer && finalOutlinePointId && sermon.outline) {
        const sectionPoints =
          overContainer === 'introduction'
            ? sermon.outline.introduction
            : overContainer === 'main'
            ? sermon.outline.main
            : overContainer === 'conclusion'
            ? sermon.outline.conclusion
            : [];
        const belongs = sectionPoints?.some((p) => p.id === finalOutlinePointId);
        if (!belongs) finalOutlinePointId = undefined;
      }
    }

    // Apply on local item
    const movedIndex = updated[overContainer].findIndex((i) => i.id === active.id);
    if (movedIndex !== -1) {
      updated[overContainer][movedIndex] = {
        ...updated[overContainer][movedIndex],
        requiredTags: updatedRequiredTags,
        outlinePointId: finalOutlinePointId,
      };
    }

    setContainers(updated);
    return updated;
  };

  test('ambiguous -> main (no outline point): set Main tag, clear outlinePointId', async () => {
    const setContainers = jest.fn();
    const containers: TestContainers = {
      ambiguous: [{ id: 't3', content: 'C', requiredTags: [], customTagNames: [], outlinePointId: null }],
      introduction: [],
      main: [],
      conclusion: [],
    };

    const event: DragEndEvent = {
      active: { id: 't3', data: { current: {} }, rect: { current: { initial: null, translated: null } } },
      over: { id: 'main', data: { current: { container: 'main' } } as any, rect: null as any, disabled: false },
      activatorEvent: {} as any,
      delta: { x: 0, y: 0 },
      collisions: null,
    };

    const updated = (await move(containers, event, setContainers))!;
    expect(updated.main).toHaveLength(1);
    expect(updated.main[0].requiredTags).toEqual(['Main Part']);
    expect(updated.main[0].outlinePointId).toBeUndefined();
  });

  test('main (with main-1 point) -> conclusion container (no point): clear outlinePointId; set Conclusion tag', async () => {
    const setContainers = jest.fn();
    const containers: TestContainers = {
      ambiguous: [],
      introduction: [],
      main: [{ id: 't2', content: 'B', requiredTags: ['Main Part'], customTagNames: [], outlinePointId: 'main-1' }],
      conclusion: [],
    };

    const event: DragEndEvent = {
      active: { id: 't2', data: { current: {} }, rect: { current: { initial: null, translated: null } } },
      over: { id: 'conclusion', data: { current: { container: 'conclusion' } } as any, rect: null as any, disabled: false },
      activatorEvent: {} as any,
      delta: { x: 0, y: 0 },
      collisions: null,
    };

    const updated = (await move(containers, event, setContainers))!;
    expect(updated.conclusion).toHaveLength(1);
    expect(updated.conclusion[0].requiredTags).toEqual(['Conclusion']);
    expect(updated.conclusion[0].outlinePointId).toBeUndefined();
  });

  test('main -> conclusion outline point: set outlinePointId to target; set Conclusion tag', async () => {
    const setContainers = jest.fn();
    const containers: TestContainers = {
      ambiguous: [],
      introduction: [],
      main: [{ id: 't2', content: 'B', requiredTags: ['Main Part'], customTagNames: [], outlinePointId: null }],
      conclusion: [],
    };

    const event: DragEndEvent = {
      active: { id: 't2', data: { current: {} }, rect: { current: { initial: null, translated: null } } },
      over: {
        id: 'outline-point-conclusion-1',
        data: { current: { container: 'conclusion', outlinePointId: 'conclusion-1' } } as any,
        rect: null as any,
        disabled: false,
      },
      activatorEvent: {} as any,
      delta: { x: 0, y: 0 },
      collisions: null,
    };

    const updated = (await move(containers, event, setContainers))!;
    expect(updated.conclusion).toHaveLength(1);
    expect(updated.conclusion[0].requiredTags).toEqual(['Conclusion']);
    expect(updated.conclusion[0].outlinePointId).toEqual('conclusion-1');
  });

  test('introduction -> unassigned within introduction: keep section tag; clear outlinePointId', async () => {
    const setContainers = jest.fn();
    const containers: TestContainers = {
      ambiguous: [],
      introduction: [{ id: 't1', content: 'A', requiredTags: ['Introduction'], customTagNames: [], outlinePointId: 'intro-1' }],
      main: [],
      conclusion: [],
    };

    const event: DragEndEvent = {
      active: { id: 't1', data: { current: {} }, rect: { current: { initial: null, translated: null } } },
      over: {
        id: 'unassigned-introduction',
        data: { current: { container: 'introduction', outlinePointId: null } } as any,
        rect: null as any,
        disabled: false,
      },
      activatorEvent: {} as any,
      delta: { x: 0, y: 0 },
      collisions: null,
    };

    const updated = (await move(containers, event, setContainers))!;
    expect(updated.introduction).toHaveLength(1);
    expect(updated.introduction[0].requiredTags).toEqual(['Introduction']);
    expect(updated.introduction[0].outlinePointId).toBeUndefined();
  });

  test('introduction -> ambiguous: clear section tag and outlinePointId', async () => {
    const setContainers = jest.fn();
    const containers: TestContainers = {
      ambiguous: [],
      introduction: [{ id: 't1', content: 'A', requiredTags: ['Introduction'], customTagNames: [], outlinePointId: 'intro-1' }],
      main: [],
      conclusion: [],
    };

    const event: DragEndEvent = {
      active: { id: 't1', data: { current: {} }, rect: { current: { initial: null, translated: null } } },
      over: { id: 'dummy-drop-zone', data: { current: { container: 'ambiguous' } } as any, rect: null as any, disabled: false },
      activatorEvent: {} as any,
      delta: { x: 0, y: 0 },
      collisions: null,
    };

    const updated = (await move(containers, event, setContainers))!;
    expect(updated.ambiguous).toHaveLength(1);
    expect(updated.ambiguous[0].requiredTags).toEqual([]);
    expect(updated.ambiguous[0].outlinePointId).toBeUndefined();
  });
});


