"use client";

import { useDraggable, useDroppable } from '@dnd-kit/core';
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import { ArrowRightIcon, CheckIcon, PencilSquareIcon, TrashIcon } from '@heroicons/react/24/outline';
import React, { useCallback } from 'react';

import hoverActions from '@/components/ui/HoverActions.module.css';
import { useTranslation } from '@locales/useTranslation';

import type { ScratchNote } from '@/models/models';
import type { ScratchPlace } from '@/utils/scratchPlacement';

/** One place a note can be moved to, in reading order: the pool, then part → point → sub-point. */
export interface ScratchMoveTarget {
  key: string;
  label: string;
  depth: 0 | 1 | 2;
  place: ScratchPlace;
  tone: 'pool' | 'part' | 'point';
  /** The part's own colour for part rows. */
  textClass?: string;
}

/** A card is also a drop spot: a note let go on it lands right before it. */
export const noteDropId = (noteId: string) => `note:${noteId}`;

interface ScratchSketchCardProps {
  note: ScratchNote;
  /** `pool`: a short card in the rail, two lines until opened. `plan`: the whole text under its place. */
  variant: 'pool' | 'plan';
  isReadOnly: boolean;
  selected?: boolean;
  /** Absent where a note is not picked for a group (notes already on a point). */
  onToggleSelect?: () => void;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  /** The note's words, editable where editing is allowed (the panel owns saving). */
  text: React.ReactNode;
  targets: ScratchMoveTarget[];
  currentKey: string;
  onMove: (place: ScratchPlace) => void;
  /** On a phone the same choice opens from below instead of beside the arrow. */
  onOpenMoveSheet: () => void;
  onDelete: () => void;
  /** Open the words for editing — the card's own pencil, never a click on the words. */
  onEdit: () => void;
  /** The words are open for editing: the field and its own «Cancel» / «Save» are all the card shows. */
  editing: boolean;
  /** Editing and deleting wait for the last write to be kept; the buttons stay in place, switched off. */
  noteLocked?: boolean;
  editLocked?: boolean;
  /** This card is in the hand together with the one being dragged. */
  carried: boolean;
  /** The note in the hand would land right above this card or right under it. */
  landing: 'before' | 'after' | null;
  /** Just landed here: a short glow says where it went. */
  justPlaced: boolean;
  /** A drop ends with a click on the spot it started from; that click must not open editing. */
  swallowClick: () => boolean;
}

/**
 * With a mouse the buttons float in the card's lower right corner (over the «Ещё» row when there is one) and appear while the card is pointed at, a key
 * has focused one of them, or the move menu is open; the card keeps its size either way. A finger has
 * no hover, so on touch screens they stay in their row under the words.
 */
const TOOLBAR = [
  'flex items-center gap-0.5 transition-opacity duration-150',
  '[@media(hover:hover)_and_(pointer:fine)]:absolute [@media(hover:hover)_and_(pointer:fine)]:bottom-1.5 [@media(hover:hover)_and_(pointer:fine)]:right-1.5',
  '[@media(hover:hover)_and_(pointer:fine)]:z-10 [@media(hover:hover)_and_(pointer:fine)]:rounded-lg [@media(hover:hover)_and_(pointer:fine)]:p-0.5 [@media(hover:hover)_and_(pointer:fine)]:shadow-sm',
  '[@media(hover:hover)_and_(pointer:fine)]:border [@media(hover:hover)_and_(pointer:fine)]:border-gray-200 [@media(hover:hover)_and_(pointer:fine)]:bg-white',
  'dark:[@media(hover:hover)_and_(pointer:fine)]:border-gray-700 dark:[@media(hover:hover)_and_(pointer:fine)]:bg-gray-800',
  'group-has-[:focus-visible]/card:opacity-100 group-has-[:focus-visible]/card:pointer-events-auto',
  'has-[[data-open]]:opacity-100 has-[[data-open]]:pointer-events-auto',
].join(' ');

const ICON_BUTTON = 'inline-flex shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100';

/**
 * A scratch note on the sorting board. The whole card is what the hand takes (buttons, links and
 * fields keep their own job), and the card is also a spot to land before. Moving without a hand:
 * «Переместить в…» — a menu beside the arrow on wide screens and a panel from below on a phone
 * (the same targets, chosen by CSS, never by guessing the width in JS).
 */
export default function ScratchSketchCard({
  note, variant, isReadOnly, selected = false, onToggleSelect, expanded = false, onToggleExpanded,
  text, targets, currentKey, onMove, onOpenMoveSheet, onDelete, onEdit, editing, noteLocked = false, editLocked = false, carried, landing, justPlaced, swallowClick,
}: ScratchSketchCardProps) {
  const { t } = useTranslation();
  const drag = useDraggable({ id: note.id, disabled: isReadOnly || editing });
  const drop = useDroppable({ id: noteDropId(note.id), disabled: isReadOnly || editing || carried });
  const setRef = useCallback((node: HTMLDivElement | null) => { drag.setNodeRef(node); drop.setNodeRef(node); }, [drag, drop]);
  const pool = variant === 'pool';
  const moveTo = t('scratch.sort.moveTo');
  const inHand = drag.isDragging || carried;
  const frame = inHand
    ? 'border-dashed border-violet-300 bg-violet-50/40 dark:border-violet-700 dark:bg-violet-950/20'
    : selected
      ? 'border-violet-300 bg-violet-50 dark:border-violet-500/60 dark:bg-violet-950/30'
      : pool ? 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800' : 'border-transparent bg-gray-50 dark:bg-gray-800/60';

  return (
    <div ref={setRef} {...drag.listeners} {...drag.attributes} role="group" tabIndex={-1} aria-disabled={undefined}
      data-testid={`scratch-sketch-${note.id}`}
      onClickCapture={(event) => { if (swallowClick()) { event.preventDefault(); event.stopPropagation(); } }}
      className={`group/card ${hoverActions.row} relative flex items-start gap-1 rounded-xl border py-1.5 pl-1 pr-1 outline-none transition-[background-color,border-color,box-shadow] duration-300 [-webkit-touch-callout:none] [touch-action:manipulation] ${
        isReadOnly || editing ? '' : 'cursor-grab select-none active:cursor-grabbing'} ${frame} ${
        justPlaced ? 'shadow-[0_0_0_3px_rgba(139,92,246,0.35)]' : ''}`}>
      {/* Where the note in the hand would land: right above this card or right under it. */}
      {landing && !inHand && <span aria-hidden="true" className={`pointer-events-none absolute left-2 right-2 h-[3px] rounded-full bg-violet-500 shadow-[0_0_0_3px_rgba(139,92,246,0.18)] ${landing === 'before' ? '-top-[5px]' : '-bottom-[5px]'}`} />}
      <div className={`flex min-w-0 flex-1 items-start gap-1 ${inHand ? 'opacity-40' : ''}`}>
        {onToggleSelect && (
          <button type="button" role="checkbox" aria-checked={selected} aria-label={t('scratch.sort.select')}
            onClick={onToggleSelect} disabled={isReadOnly}
            className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-40 md:h-9 md:w-9">
            <span className={`inline-flex h-5 w-5 items-center justify-center rounded-md border-[1.5px] transition-colors ${selected
              ? 'border-violet-600 bg-violet-600 text-white' : 'border-gray-400 bg-white dark:border-gray-500 dark:bg-gray-900'}`}>
              {selected && <CheckIcon className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />}
            </span>
          </button>
        )}
        <div className={`min-w-0 flex-1 [@media(hover:hover)_and_(pointer:fine)]:pb-1 ${onToggleSelect ? 'pt-2 md:pt-1.5' : 'pl-2.5 pt-1.5'}`}>
          {pool && !expanded && !editing
            ? <p className="line-clamp-3 whitespace-pre-wrap break-words text-[15px] leading-snug text-gray-800 md:line-clamp-2 md:text-sm dark:text-gray-100">{note.text}</p>
            : text}
          {/* One row under the words (on touch screens): the words keep the whole width of the card. */}
          {!editing && <div className="mt-0.5 flex items-center gap-0.5">
            {pool && onToggleExpanded && (
              <button type="button" onClick={onToggleExpanded}
                className="min-h-9 cursor-pointer rounded px-0.5 text-sm font-medium text-violet-700 hover:text-violet-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 md:min-h-7 md:text-xs dark:text-violet-300">
                {expanded ? t('scratch.sort.less') : t('scratch.sort.more')}
              </button>
            )}
            <span className="flex-1" />
            {!isReadOnly && (
              <div className={`${TOOLBAR} ${hoverActions.actions}`}>
                {/* Wide screens: the choice opens beside the arrow and never changes the card's size. */}
                <Menu as="div" className="hidden md:block">
                  <MenuButton aria-label={moveTo} title={moveTo} className={`${ICON_BUTTON} h-8 w-8 cursor-pointer`}>
                    <ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
                  </MenuButton>
                  <MenuItems anchor="bottom end" aria-label={moveTo}
                    className="z-50 max-h-80 w-72 overflow-y-auto rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg [--anchor-gap:6px] [--anchor-padding:16px] focus:outline-none dark:border-gray-700 dark:bg-gray-800">
                    {targets.map((target) => {
                      const here = target.key === currentKey;
                      return (
                        <MenuItem key={target.key} disabled={here}>
                          <button type="button" onClick={() => onMove(target.place)}
                            className={`flex min-h-9 w-full items-center rounded-lg py-1.5 pr-2 text-left text-sm data-[focus]:bg-gray-100 data-[disabled]:cursor-default data-[disabled]:text-gray-400 dark:data-[focus]:bg-gray-700 ${
                              target.depth === 0 ? 'pl-2.5' : target.depth === 1 ? 'pl-6' : 'pl-10'} ${
                              target.tone === 'pool' ? 'font-medium text-violet-700 dark:text-violet-300' : target.tone === 'part' ? `font-semibold ${target.textClass ?? ''}` : 'text-gray-800 dark:text-gray-100'}`}>
                            <span className="min-w-0 truncate">{target.label}</span>
                            {here && <span className="ml-1.5 shrink-0 text-xs font-normal">· {t('scratch.sort.hereNow')}</span>}
                          </button>
                        </MenuItem>
                      );
                    })}
                  </MenuItems>
                </Menu>
                {/* A phone: the same choice from below, with targets a finger can hit. */}
                <button type="button" onClick={onOpenMoveSheet} aria-label={moveTo} className={`${ICON_BUTTON} h-11 w-11 md:hidden`}>
                  <ArrowRightIcon className="h-5 w-5" aria-hidden="true" />
                </button>
                <button type="button" onClick={onEdit} disabled={noteLocked || editLocked} aria-label={t('scratch.card.edit')} title={t('scratch.card.edit')}
                  className={`${ICON_BUTTON} h-11 w-11 cursor-pointer hover:text-violet-700 md:h-8 md:w-8 dark:hover:text-violet-300`}>
                  <PencilSquareIcon className="h-4 w-4" aria-hidden="true" />
                </button>
                <button type="button" onClick={onDelete} disabled={noteLocked} aria-label={t('scratch.card.delete')} title={t('scratch.card.delete')}
                  className={`${ICON_BUTTON} h-11 w-11 cursor-pointer hover:text-red-600 md:h-8 md:w-8 dark:hover:text-red-400`}>
                  <TrashIcon className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>}
        </div>
      </div>
    </div>
  );
}
