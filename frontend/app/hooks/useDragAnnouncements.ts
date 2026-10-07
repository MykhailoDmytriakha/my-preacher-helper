'use client';

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { Active, Announcements, Over, ScreenReaderInstructions, UniqueIdentifier } from '@dnd-kit/core';
import type { DragStart, DragUpdate, DropResult, ResponderProvided } from '@hello-pangea/dnd';

/**
 * WHAT A SCREEN READER HEARS WHILE SOMETHING IS DRAGGED, IN THE LANGUAGE ON SCREEN
 * (BUG-20261006-library-screen-reader-words-english). Both drag libraries speak their own English
 * words unless the app hands them its own: the hint on a handle and the announcements on pick up,
 * move and drop. One set of words for every list, said by position — an item's id is not a name —
 * and, where an item can change list or land on a place of its own, by the name of that place.
 */
type Translate = (key: string, values?: Record<string, unknown>) => string;

type SortableData = { sortable?: { containerId?: UniqueIdentifier; index?: unknown } };
const sortableOf = (entry: Active | Over | null | undefined) => (entry?.data.current as SortableData | undefined)?.sortable;
/** The 1-based place of a sortable item (`useSortable` puts `{ sortable: { index, containerId } }` in its data). */
const sortablePosition = (entry: Active | Over | null | undefined): number | null => {
  const index = sortableOf(entry)?.index;
  return typeof index === 'number' ? index + 1 : null;
};

export interface DndKitPlaces {
  /**
   * A board whose targets are places of their own (a section, a gap, a point): the place, in words;
   * null when the carried card cannot land there (the drop would do nothing); undefined to say nothing special.
   */
  placeOf?: (over: Over, active: Active) => string | null | undefined;
  /** Sortable lists side by side (columns): a list's name, said when the item moves to another list. */
  containerName?: (containerId: UniqueIdentifier) => string | undefined;
}

function dndKitWords(t: Translate, { placeOf, containerName }: DndKitPlaces) {
  const at = (key: string, position: number | null) => (position === null ? t(`dragAndDrop.${key}`) : t(`dragAndDrop.${key}At`, { position }));
  const where = (key: 'moved' | 'dropped', active: Active, over: Over) => {
    const place = placeOf?.(over, active);
    if (place === null) return t(key === 'moved' ? 'dragAndDrop.outside' : 'dragAndDrop.droppedOutside');
    if (place) return t(`dragAndDrop.${key}To`, { place });
    const from = sortableOf(active)?.containerId, to = sortableOf(over)?.containerId;
    const list = to !== undefined && to !== from ? containerName?.(to) : undefined;
    const position = sortablePosition(over);
    return list && position !== null ? t(`dragAndDrop.${key}ToListAt`, { list, position }) : at(key, position);
  };
  // Right after a pick up the item is "over" itself; saying so would replace "picked up" in the live region.
  let justPickedUp = false;
  const screenReaderInstructions: ScreenReaderInstructions = { draggable: t('dragAndDrop.instructions') };
  const announcements: Announcements = {
    onDragStart: ({ active }) => { justPickedUp = true; return at('pickedUp', sortablePosition(active)); },
    onDragOver: ({ active, over }) => {
      const overItself = justPickedUp && over?.id === active.id;
      justPickedUp = false;
      if (overItself) return undefined;
      return over ? where('moved', active, over) : t('dragAndDrop.outside');
    },
    onDragEnd: ({ active, over }) => (over ? where('dropped', active, over) : t('dragAndDrop.droppedOutside')),
    onDragCancel: () => t('dragAndDrop.cancelled'),
  };
  return { announcements, screenReaderInstructions };
}

/** `accessibility` for a `DndContext` (@dnd-kit). Pass the places when an item can land somewhere a position does not name. */
export function useDndKitAccessibility({ placeOf, containerName }: DndKitPlaces = {}) {
  const { t } = useTranslation();
  return useMemo(() => dndKitWords(t as Translate, { placeOf, containerName }), [t, placeOf, containerName]);
}

function pangeaWords(t: Translate, listName?: (droppableId: string) => string | undefined) {
  const to = (key: 'moved' | 'dropped', source: { droppableId: string }, destination: { droppableId: string; index: number }) => {
    const position = destination.index + 1;
    const list = destination.droppableId !== source.droppableId ? listName?.(destination.droppableId) : undefined;
    return list ? t(`dragAndDrop.${key}ToListAt`, { list, position }) : t(`dragAndDrop.${key}At`, { position });
  };
  return {
    // This library lifts and drops with Space only; Enter does nothing here.
    dragHandleUsageInstructions: t('dragAndDrop.instructionsSpace'),
    announceStart: (start: DragStart, provided: ResponderProvided) =>
      provided.announce(t('dragAndDrop.pickedUpAt', { position: start.source.index + 1 })),
    announceUpdate: (update: DragUpdate, provided: ResponderProvided) =>
      provided.announce(update.destination ? to('moved', update.source, update.destination) : t('dragAndDrop.outside')),
    announceEnd: (result: DropResult, provided: ResponderProvided) =>
      provided.announce(result.reason === 'CANCEL' ? t('dragAndDrop.cancelled')
        : result.destination ? to('dropped', result.source, result.destination) : t('dragAndDrop.droppedOutside')),
  };
}

/**
 * The hint and the announcements for a `DragDropContext` (@hello-pangea/dnd). A responder that calls
 * `announce` replaces the library's own English sentence, so the context's `onDragStart`,
 * `onDragUpdate` and `onDragEnd` call these with the `provided` they receive. `listName` names a
 * list an item moves into, as the library's own sentence did.
 */
export function usePangeaAnnouncements(listName?: (droppableId: string) => string | undefined) {
  const { t } = useTranslation();
  return useMemo(() => pangeaWords(t as Translate, listName), [t, listName]);
}
