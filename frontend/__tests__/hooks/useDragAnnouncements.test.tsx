import { render, renderHook, screen } from '@testing-library/react';
import React from 'react';
import { DayPicker } from 'react-day-picker';

import { useAppLocale } from '@/hooks/useAppLocale';
import { useDndKitAccessibility, usePangeaAnnouncements } from '@/hooks/useDragAnnouncements';
import '@testing-library/jest-dom';

import type { Active, Over } from '@dnd-kit/core';
import type { DragStart, DragUpdate, DropResult } from '@hello-pangea/dnd';

/**
 * WHAT THE SCREEN READER HEARS, IN THE INTERFACE LANGUAGE (BUG-20261006-library-screen-reader-words-english).
 * The drag libraries and the calendar spoke their own English; the app now hands them its words.
 */
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'ru' },
    t: (key: string, values?: Record<string, unknown>) => `ru:${key}${values ? JSON.stringify(values) : ''}`,
  }),
}));

const sortable = (index: number, containerId = 'list') => ({ id: `item-${index}`, data: { current: { sortable: { containerId, items: [], index } } } });

describe('drag announcements', () => {
  it('gives @dnd-kit a translated hint and says pick up, move and drop by position', () => {
    const { result } = renderHook(() => useDndKitAccessibility());
    const { announcements, screenReaderInstructions } = result.current;
    expect(screenReaderInstructions.draggable).toBe('ru:dragAndDrop.instructions');
    expect(announcements.onDragStart({ active: sortable(2) as unknown as Active })).toBe('ru:dragAndDrop.pickedUpAt{"position":3}');
    // Over itself right after the pick up: silent, so "picked up" stays in the live region.
    expect(announcements.onDragOver({ active: sortable(2) as unknown as Active, over: sortable(2) as unknown as Over })).toBeUndefined();
    expect(announcements.onDragOver({ active: sortable(2) as unknown as Active, over: sortable(0) as unknown as Over })).toBe('ru:dragAndDrop.movedAt{"position":1}');
    expect(announcements.onDragOver({ active: sortable(2) as unknown as Active, over: null })).toBe('ru:dragAndDrop.outside');
    // A column, not a sortable item: no position to name.
    expect(announcements.onDragEnd({ active: sortable(2) as unknown as Active, over: { id: 'column', data: { current: {} } } as unknown as Over })).toBe('ru:dragAndDrop.dropped');
    expect(announcements.onDragEnd({ active: sortable(2) as unknown as Active, over: null })).toBe('ru:dragAndDrop.droppedOutside');
    expect(announcements.onDragCancel({ active: sortable(2) as unknown as Active, over: null })).toBe('ru:dragAndDrop.cancelled');
  });

  it('announces through @hello-pangea/dnd instead of its English defaults', () => {
    const { result } = renderHook(() => usePangeaAnnouncements());
    const announce = jest.fn();
    const words = result.current;
    // This library lifts with Space only, so its hint does not offer Enter.
    expect(words.dragHandleUsageInstructions).toBe('ru:dragAndDrop.instructionsSpace');
    const source = { droppableId: 'list', index: 0 };
    words.announceStart({ source } as DragStart, { announce });
    words.announceUpdate({ source, destination: { droppableId: 'list', index: 4 } } as DragUpdate, { announce });
    words.announceUpdate({ source, destination: null } as DragUpdate, { announce });
    words.announceEnd({ reason: 'DROP', source, destination: { droppableId: 'list', index: 1 } } as DropResult, { announce });
    words.announceEnd({ reason: 'DROP', source, destination: null } as DropResult, { announce });
    words.announceEnd({ reason: 'CANCEL', source, destination: null } as DropResult, { announce });
    expect(announce.mock.calls.map(([message]) => message)).toEqual([
      'ru:dragAndDrop.pickedUpAt{"position":1}', 'ru:dragAndDrop.movedAt{"position":5}', 'ru:dragAndDrop.outside',
      'ru:dragAndDrop.droppedAt{"position":2}', 'ru:dragAndDrop.droppedOutside', 'ru:dragAndDrop.cancelled',
    ]);
  });
});

describe('drag announcements that name where the item goes', () => {
  it('says a board\'s own place when a position would name nothing', () => {
    const { result } = renderHook(() => useDndKitAccessibility({ placeOf: over => (over.id === 'section:main' ? 'конец раздела «Основная часть»' : undefined) }));
    const { announcements } = result.current;
    announcements.onDragStart({ active: { id: 'point:p1', data: { current: {} } } as unknown as Active });
    expect(announcements.onDragOver({ active: { id: 'point:p1' } as Active, over: { id: 'section:main', data: { current: {} } } as unknown as Over }))
      .toBe('ru:dragAndDrop.movedTo{"place":"конец раздела «Основная часть»"}');
  });

  it('says a place the carried card cannot land in as such, not as a place', () => {
    const { result } = renderHook(() => useDndKitAccessibility({ placeOf: () => null }));
    const { announcements } = result.current;
    const active = { id: 'point:p1', data: { current: {} } } as unknown as Active, over = { id: 'subgap:p1:0', data: { current: {} } } as unknown as Over;
    expect(announcements.onDragOver({ active, over })).toBe('ru:dragAndDrop.outside');
    expect(announcements.onDragEnd({ active, over })).toBe('ru:dragAndDrop.droppedOutside');
  });

  it('names the list a sortable item moves into, and only then', () => {
    const { result } = renderHook(() => useDndKitAccessibility({ containerName: id => (id === 'main' ? 'Основная часть' : undefined) }));
    const { announcements } = result.current;
    const active = sortable(0, 'introduction') as unknown as Active;
    announcements.onDragStart({ active });
    expect(announcements.onDragOver({ active, over: sortable(2, 'main') as unknown as Over })).toBe('ru:dragAndDrop.movedToListAt{"list":"Основная часть","position":3}');
    expect(announcements.onDragEnd({ active, over: sortable(1, 'introduction') as unknown as Over })).toBe('ru:dragAndDrop.droppedAt{"position":2}');
  });

  it('names the section a point moves into with @hello-pangea/dnd', () => {
    const { result } = renderHook(() => usePangeaAnnouncements(id => (id === 'conclusion' ? 'Заключение' : undefined)));
    const announce = jest.fn();
    const source = { droppableId: 'introduction', index: 0 };
    result.current.announceUpdate({ source, destination: { droppableId: 'conclusion', index: 0 } } as DragUpdate, { announce });
    result.current.announceEnd({ reason: 'DROP', source, destination: { droppableId: 'introduction', index: 2 } } as DropResult, { announce });
    expect(announce.mock.calls.map(([message]) => message)).toEqual([
      'ru:dragAndDrop.movedToListAt{"list":"Заключение","position":1}', 'ru:dragAndDrop.droppedAt{"position":3}',
    ]);
  });
});

it('gives the calendar labels in the interface language', () => {
  function Calendar() {
    const { dayPickerLocale } = useAppLocale();
    return <DayPicker mode="single" month={new Date(2026, 9, 1)} locale={dayPickerLocale} />;
  }
  render(<Calendar />);
  expect(screen.getByRole('button', { name: 'Перейти к следующему месяцу' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Перейти к предыдущему месяцу' })).toBeInTheDocument();
});
