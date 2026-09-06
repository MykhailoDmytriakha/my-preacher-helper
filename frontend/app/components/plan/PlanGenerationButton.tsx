import { Sparkles } from 'lucide-react';
import React from 'react';

/** One generation affordance for both plan sources; only its own request is busy. */
export default function PlanGenerationButton({ colors, generating, disabled, label, onClick, id, expanded, controls }: {
  colors: { base: string; light: string; dark: string };
  generating: boolean;
  disabled: boolean;
  label: string;
  onClick: () => void;
  id?: string;
  expanded?: boolean;
  controls?: string;
}) {
  return (
    <button id={id} type="button" onClick={onClick} disabled={disabled} title={label} aria-label={label} aria-busy={generating}
      aria-expanded={expanded} aria-controls={controls}
      className={`rounded-md text-sm font-medium text-white transition-colors section-button px-2 py-1 h-8 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      style={{ backgroundColor: colors.light, '--hover-bg': colors.dark, '--active-bg': colors.base, borderColor: colors.dark } as React.CSSProperties}>
      {generating
        ? <span aria-hidden="true" className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-solid border-gray-300 border-t-blue-600" />
        : <Sparkles aria-hidden="true" className="h-4 w-4" />}
    </button>
  );
}
