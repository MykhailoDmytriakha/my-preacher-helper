'use client';

import React from 'react';

export const ACTION_BUTTON_SLOT_CLASS = 'flex-1 basis-0 min-w-[64px]';
export const ACTION_BUTTON_BASE_CLASS =
  'w-full h-9 px-2 sm:px-3 text-xs sm:text-sm leading-none rounded-md transition-colors text-center inline-flex items-center justify-center gap-1.5 whitespace-nowrap';

interface ActionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
}

const ActionButton: React.FC<ActionButtonProps> = ({ className = '', type = 'button', ...props }) => (
  <button
    type={type}
    className={`${ACTION_BUTTON_BASE_CLASS} ${className}`.trim()}
    {...props}
  />
);

export default ActionButton;
