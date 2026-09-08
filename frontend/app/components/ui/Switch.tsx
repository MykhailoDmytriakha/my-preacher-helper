'use client';

import type { ButtonHTMLAttributes } from 'react';

interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'role' | 'aria-checked'> {
  checked: boolean;
}

/** Native button semantics provide keyboard activation and disabled behavior. */
export default function Switch({ checked, className = '', type = 'button', ...props }: SwitchProps) {
  return (
    <button
      {...props}
      type={type}
      role="switch"
      aria-checked={checked}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-60 ${checked ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-600'} ${className}`.trim()}
    >
      <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  );
}
