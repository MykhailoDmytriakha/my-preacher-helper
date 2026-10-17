'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'role' | 'aria-checked'> {
  checked: boolean;
  /**
   * A visible name inside the switch itself: the word and the track are one control, 44 px tall, so a
   * finger that lands on the word or a little off the track still switches it, and nothing else under
   * it is pressed instead (the owner's iPad, 2026-10-16: a small switch over a row's own button).
   */
  label?: ReactNode;
}

const TRACK = 'relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out';
const trackColour = (checked: boolean) => (checked ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-600');

function Knob({ checked }: { checked: boolean }) {
  return <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${checked ? 'translate-x-5' : 'translate-x-0'}`} />;
}

/** Native button semantics provide keyboard activation and disabled behavior. */
export default function Switch({ checked, label, className = '', type = 'button', ...props }: SwitchProps) {
  if (label !== undefined) {
    return (
      <button
        {...props}
        type={type}
        role="switch"
        aria-checked={checked}
        className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-60 ${className}`.trim()}
      >
        <span className="text-xs font-medium text-gray-600 dark:text-gray-400">{label}</span>
        <span aria-hidden="true" className={`${TRACK} ${trackColour(checked)}`}>
          <Knob checked={checked} />
        </span>
      </button>
    );
  }
  // The track is 24 px tall; its touch area reaches 44 px, so a finger a little off still switches it
  // instead of needing a second tap (the owner's iPad, 2026-10-16).
  return (
    <button
      {...props}
      type={type}
      role="switch"
      aria-checked={checked}
      className={`${TRACK} before:absolute before:-inset-x-1 before:-inset-y-2.5 before:content-[''] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-60 ${trackColour(checked)} ${className}`.trim()}
    >
      <Knob checked={checked} />
    </button>
  );
}
