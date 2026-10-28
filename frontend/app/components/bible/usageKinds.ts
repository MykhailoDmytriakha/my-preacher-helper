import { BookOpenIcon, HeartIcon, RectangleStackIcon, UsersIcon } from '@heroicons/react/20/solid';

import { CommentIcon } from '@/components/Icons';

import type { ChipTone } from '@/components/ui/Chip';
import type { ScriptureUsageKind } from '@/utils/scriptureUsage';
import type { ComponentType, SVGProps } from 'react';

/**
 * HOW EACH KIND OF THE PERSON'S MATERIAL LOOKS ON THE BIBLE TEXT: the colour and the icon of its section in
 * the menu (`navigation/navConfig.ts`, `NAV_ITEM_THEMES`) — sermons blue with an open book, notes (Studies)
 * green with a stack, groups amber with people, service orders (Ministry) rose with a heart — so a badge
 * (a comment is a study note's short kind: grey as the pencil under words, three lines and a pencil — the owner, 2026-10-28)
 * says whose it is before it is read. `dot` is the minimap's paint, which a canvas cannot take as a class.
 */
export type UsageKindLook = {
  tone: ChipTone;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** The kind's word, `bible.mine.kinds.<kind>`. */
  wordKey: string;
  dot: { light: string; dark: string };
  /**
   * The badge (`MineBadge`, the owner's choice 2026-10-21 on the canvas: «Б · Кружок»): a light capsule with a
   * thin border, a solid circle with the white icon, the number as a white circle with a border of the colour.
   * Whole class names, so Tailwind finds them.
   */
  badge: { capsule: string; circle: string; count: string };
};

export const USAGE_KIND_LOOK: Record<ScriptureUsageKind, UsageKindLook> = {
  sermon: {
    tone: 'blue', Icon: BookOpenIcon, wordKey: 'bible.mine.kinds.sermon', dot: { light: '#2563eb', dark: '#60a5fa' },
    badge: { capsule: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-transparent dark:text-blue-300', circle: 'bg-blue-600', count: 'text-blue-700 ring-blue-500 dark:text-blue-300 dark:ring-blue-400' },
  },
  note: {
    tone: 'emerald', Icon: RectangleStackIcon, wordKey: 'bible.mine.kinds.note', dot: { light: '#059669', dark: '#34d399' },
    badge: { capsule: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-transparent dark:text-emerald-300', circle: 'bg-emerald-600', count: 'text-emerald-700 ring-emerald-500 dark:text-emerald-300 dark:ring-emerald-400' },
  },
  comment: {
    tone: 'neutral', Icon: CommentIcon, wordKey: 'bible.mine.kinds.comment', dot: { light: '#8b8f98', dark: '#9ca3af' },
    badge: { capsule: 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-transparent dark:text-gray-300', circle: 'bg-gray-500', count: 'text-gray-600 ring-gray-500 dark:text-gray-300 dark:ring-gray-400' },
  },
  group: {
    tone: 'amber', Icon: UsersIcon, wordKey: 'bible.mine.kinds.group', dot: { light: '#d97706', dark: '#fbbf24' },
    badge: { capsule: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-transparent dark:text-amber-300', circle: 'bg-amber-600', count: 'text-amber-700 ring-amber-500 dark:text-amber-300 dark:ring-amber-400' },
  },
  order: {
    tone: 'rose', Icon: HeartIcon, wordKey: 'bible.mine.kinds.order', dot: { light: '#e11d48', dark: '#fb7185' },
    badge: { capsule: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-transparent dark:text-rose-300', circle: 'bg-rose-600', count: 'text-rose-700 ring-rose-500 dark:text-rose-300 dark:ring-rose-400' },
  },
};
