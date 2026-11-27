'use client';

import { Menu, MenuButton, MenuItem, MenuItems, MenuSeparator } from '@headlessui/react';
import { EllipsisHorizontalIcon } from '@heroicons/react/24/outline';
import { Fragment, type ComponentType, type SVGProps } from 'react';

import { QUIET_BUTTON } from '@/components/hardQuestions/parts';
import { useAfterMenuCloses } from '@/hooks/useAfterMenuCloses';

export type MenuAction = {
  key: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  onSelect: () => void;
  /** A removal: last, after a line, in red. */
  danger?: boolean;
};

const MENU_ITEM = 'flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm font-semibold';

/**
 * AN OPEN PAGE'S RARER ACTIONS BEHIND «⋯», beside the one done often (the owner chose it for the theme's header from
 * a board, 2026-11-26, and for the basis's page after it): the same on a mouse and on touch, a removal last, apart,
 * in red. Each action opens a window, which waits for the menu to hand focus back (`useAfterMenuCloses`) so the
 * window keeps the keyboard.
 */
export function ActionsMenu({ label, disabled = false, actions }: { label: string; disabled?: boolean; actions: readonly MenuAction[] }) {
  const menu = useAfterMenuCloses();
  const kept = actions.filter((action) => !action.danger);
  const removals = actions.filter((action) => action.danger);
  const item = (action: MenuAction) => (
    <MenuItem key={action.key}>
      <button type="button" onClick={menu.later(action.onSelect)} className={`${MENU_ITEM} ${action.danger
        ? 'text-red-700 data-[focus]:bg-red-50 dark:text-red-300 dark:data-[focus]:bg-red-950/40'
        : 'text-gray-800 data-[focus]:bg-gray-100 dark:text-gray-100 dark:data-[focus]:bg-gray-700'}`}>
        <action.icon className="h-4 w-4 shrink-0" aria-hidden="true" />{action.label}
      </button>
    </MenuItem>
  );
  return (
    <Menu>
      <MenuButton disabled={disabled} aria-label={label} title={label} onFocus={menu.onButtonFocus}
        className={`${QUIET_BUTTON} w-11 shrink-0 px-0 data-[open]:bg-gray-100 dark:data-[open]:bg-gray-800`}>
        <EllipsisHorizontalIcon className="h-5 w-5" aria-hidden="true" />
      </MenuButton>
      <MenuItems anchor="bottom end" aria-label={label}
        className="z-50 w-60 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg [--anchor-gap:6px] [--anchor-padding:16px] focus:outline-none dark:border-gray-700 dark:bg-gray-800">
        {kept.map(item)}
        {kept.length > 0 && removals.length > 0 && <MenuSeparator className="mx-1 my-1.5 h-px bg-gray-200 dark:bg-gray-700" />}
        {removals.map((action) => <Fragment key={action.key}>{item(action)}</Fragment>)}
      </MenuItems>
    </Menu>
  );
}
