'use client';

import {
  closestCenter,
  defaultDropAnimationSideEffects,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { useDndKitAccessibility } from '@/hooks/useDragAnnouncements';

/** What a row puts on its handle: the library's listeners and the ref it activates from. */
export type DragHandleProps = ButtonHTMLAttributes<HTMLButtonElement> & { ref?: (node: HTMLButtonElement | null) => void };

/**
 * The grip a row is picked up by. Only the grip starts a drag, so the row stays a link, its text stays
 * selectable and a scroll that begins on it stays a scroll. In the flying copy it is drawn, not pressable.
 */
export function DragHandle({ label, handle }: { label: string; handle?: DragHandleProps }) {
  return (
    <button
      type="button"
      aria-label={label}
      tabIndex={handle ? undefined : -1}
      className="flex h-11 w-11 shrink-0 touch-none select-none cursor-grab items-center justify-center rounded-lg text-gray-400 transition hover:text-gray-600 active:cursor-grabbing dark:text-gray-500 dark:hover:text-gray-300"
      {...handle}
    >
      <GripVertical className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
    </button>
  );
}

function SortableItem({ id, className, children }: { id: string; className?: string; children: (handle: DragHandleProps) => ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li ref={setNodeRef} className={className} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0 : undefined }}>
      {children({ ...attributes, ...listeners, ref: setActivatorNodeRef })}
    </li>
  );
}

/**
 * A LIST REARRANGED BY HAND: each row is dragged by its grip, and the row may carry arrows beside it for
 * a keyboard and a thumb. The setup the orders of service and the council use — the grip alone starts a
 * drag, eight pixels before it does, a keyboard can lift and drop, the screen reader hears the app's
 * language, and the row itself flies under the finger — written once for the lists that came after them.
 *
 * `onMove(id, ontoId, side)` says what the eye saw: the dropped row stands just before the row it was
 * dropped on when it travelled up, just after it when it travelled down. The list shows that order at
 * once and holds it until `items` arrive in that very order, or the latest drop's move ends; an earlier
 * drop ending, or an earlier order arriving, does not take the screen back (Codex review, 2026-11-26).
 */
export function SortableList<T extends { id: string }>({
  items,
  layout = 'list',
  className,
  itemClassName,
  onMove,
  renderItem,
}: {
  items: readonly T[];
  /** `grid` for cards in columns: a drag then moves along rows as well as down. */
  layout?: 'list' | 'grid';
  className?: string;
  itemClassName?: string;
  onMove: (id: string, ontoId: string, side: 'before' | 'after') => Promise<unknown>;
  /** The row. `handle` is absent in the flying copy, which `overlay` marks. */
  renderItem: (item: T, index: number, handle: DragHandleProps | undefined, overlay: boolean) => ReactNode;
}) {
  const accessibility = useDndKitAccessibility();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [held, setHeld] = useState<{ order: string[]; drop: number } | null>(null);
  const drops = useRef(0);
  const order = items.map((item) => item.id).join('\n');
  // The list has arrived in the order held on screen: nothing left to hold.
  useEffect(() => { setHeld((current) => (current && current.order.join('\n') === order ? null : current)); }, [order]);

  const shown = useMemo(() => {
    if (!held) return items;
    const byId = new Map(items.map((item) => [item.id, item]));
    const kept = held.order.map((id) => byId.get(id)).filter((item): item is T => Boolean(item));
    return kept.length === items.length ? kept : items;
  }, [held, items]);
  const active = activeId ? shown.find((item) => item.id === activeId) : undefined;

  const onDragEnd = ({ active: dragged, over }: DragEndEvent) => {
    setActiveId(null);
    if (!over || dragged.id === over.id) return;
    const ids = shown.map((item) => item.id);
    const from = ids.indexOf(String(dragged.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, String(dragged.id));
    const drop = ++drops.current;
    setHeld({ order: next, drop });
    // Only the latest drop lets go: an earlier one ending must not show the order before it.
    const release = () => setHeld((current) => (current && current.drop === drop ? null : current));
    void onMove(String(dragged.id), String(over.id), from < to ? 'after' : 'before').catch(() => undefined).finally(release);
  };

  return (
    <DndContext
      accessibility={accessibility}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={({ active: lifted }) => setActiveId(String(lifted.id))}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={shown.map((item) => item.id)} strategy={layout === 'grid' ? rectSortingStrategy : verticalListSortingStrategy}>
        <ul className={className}>
          {shown.map((item, index) => (
            <SortableItem key={item.id} id={item.id} className={itemClassName}>
              {(handle) => renderItem(item, index, handle, false)}
            </SortableItem>
          ))}
        </ul>
      </SortableContext>
      <DragOverlay dropAnimation={{ sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0' } } }) }}>
        {active ? <div aria-hidden="true" inert>{renderItem(active, shown.indexOf(active), undefined, true)}</div> : null}
      </DragOverlay>
    </DndContext>
  );
}
