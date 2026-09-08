import { act, renderHook } from '@testing-library/react';
import { useRef, useState } from 'react';

import { updateStructure } from '@/services/structure.service';
import { updateThought } from '@/services/thought.service';

import { useStructureDnd } from '../useStructureDnd';

import type { Item, Sermon } from '@/models/models';
import type { DragOverEvent, DragStartEvent } from '@dnd-kit/core';

jest.mock('@/services/structure.service', () => ({ updateStructure: jest.fn() }));
jest.mock('@/services/thought.service', () => ({ updateThought: jest.fn() }));

const item = (id: string, position: number): Item => ({ id, position, content: id, requiredTags: [], customTagNames: [] });
const initial = { introduction: [item('first', 1000), item('last', 3000)], main: [], conclusion: [], ambiguous: [item('moving', 2000)] };
const sermon: Sermon = { id: 'sermon', userId: 'user', title: 'Title', verse: '', date: '2026-09-07', thoughts: [], structure: { introduction: ['first', 'last'], main: [], conclusion: [], ambiguous: ['moving'] } };
const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;

function setup() {
  return renderHook(() => {
    const [containers, setContainers] = useState<Record<string, Item[]>>(initial);
    const containersRef = useRef(containers);
    const dnd = useStructureDnd({ containers, setContainers, containersRef, sermon, setSermon: jest.fn(), debouncedSaveThought: jest.fn() });
    return { containers, containersRef, dnd };
  });
}
const start = { active: { id: 'moving' } } as DragStartEvent;
const over = (id: string, container?: string, activeId = 'moving') => ({ active: { id: activeId }, over: { id, data: container ? { current: { container } } : undefined } }) as unknown as DragOverEvent;
const ids = (containers: Record<string, Item[]>) => Object.fromEntries(Object.entries(containers).map(([key, items]) => [key, items.map(item => item.id)]));
function flushFrames() {
  act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0)); });
}
beforeEach(() => {
  jest.clearAllMocks(); frames.clear(); frameId = 0;
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++frameId, callback); return frameId; });
  jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
});
afterEach(() => jest.restoreAllMocks());

it('previews exact placement through the live ref, coalesces frames and never starts a write', () => {
  const { result } = setup();
  act(() => result.current.dnd.handleDragStart(start));
  act(() => result.current.dnd.handleDragOver(over('last', 'introduction')));
  expect(ids(result.current.containers)).toEqual(ids(initial));
  expect(result.current.containersRef.current.introduction.map(item => item.id)).toEqual(['first', 'moving', 'last']);
  act(() => result.current.dnd.handleDragOver(over('main')));
  expect(frames.size).toBe(1);
  flushFrames();
  expect(ids(result.current.containers)).toEqual({ introduction: ['first', 'last'], main: ['moving'], conclusion: [], ambiguous: [] });
  expect(Object.values(result.current.containers).flat().filter(item => item.id === 'moving')).toHaveLength(1);
  expect(updateStructure).not.toHaveBeenCalled();
  expect(updateThought).not.toHaveBeenCalled();
});

it.each([false, true])('cancel restores membership and positions and retires pending preview frames (flushed=%s)', flushed => {
  const { result } = setup();
  act(() => result.current.dnd.handleDragStart(start));
  act(() => result.current.dnd.handleDragOver(over('last', 'introduction')));
  if (flushed) flushFrames();
  act(() => result.current.dnd.handleDragCancel());
  expect(frames.size).toBe(0);
  expect(result.current.containers).toEqual(initial);
  expect(result.current.containersRef.current).toEqual(initial);
  expect(result.current.dnd.activeId).toBeNull();
  flushFrames();
  expect(result.current.containers).toEqual(initial);
  expect(updateStructure).not.toHaveBeenCalled();
  expect(updateThought).not.toHaveBeenCalled();
});

it.each([
  ['no target', { active: { id: 'moving' }, over: null } as DragOverEvent],
  ['missing source', over('main', undefined, 'missing')],
  ['unknown destination', over('unknown')],
  ['self target', over('moving')],
])('keeps the current arrangement for %s', (_name, event) => {
  const { result } = setup();
  act(() => result.current.dnd.handleDragStart(start));
  act(() => result.current.dnd.handleDragOver(event));
  flushFrames();
  expect(result.current.containers).toEqual(initial);
  expect(result.current.containersRef.current).toEqual(initial);
  expect(updateStructure).not.toHaveBeenCalled();
  expect(updateThought).not.toHaveBeenCalled();
});
