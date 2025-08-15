'use client';

import React from 'react';
import { UI_COLORS } from '@/utils/themeColors';
import { ChevronDown } from 'lucide-react';

export interface PrepStepCardProps {
  stepId: string;
  stepNumber: number;
  title: string;
  icon: React.ReactNode;
  isActive: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  stepRef?: (el: HTMLDivElement | null) => void;
  done?: boolean;
}

const PrepStepCard: React.FC<PrepStepCardProps> = ({
  stepId,
  stepNumber,
  title,
  icon,
  isActive,
  isExpanded,
  onToggle,
  children,
  stepRef,
  done = false,
}) => {
  return (
    <div
      ref={stepRef}
      className={`p-4 sm:p-6 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 ${
        isActive ? `border-2 border-l-4 ${UI_COLORS.accent.border} dark:${UI_COLORS.accent.darkBorder}` : ''
      }`}
    >
      <button
        type="button"
        aria-expanded={isExpanded}
        aria-controls={`step-${stepId}-panel`}
        onClick={onToggle}
        className="w-full text-left"
      >
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center justify-center w-6 h-6 text-xs font-semibold rounded-full border ${UI_COLORS.accent.border} dark:${UI_COLORS.accent.darkBorder} ${UI_COLORS.accent.bg} dark:${UI_COLORS.accent.darkBg} ${UI_COLORS.accent.text} dark:${UI_COLORS.accent.darkText}`}
          >
            {stepNumber}
          </span>
          <div
            className={`inline-flex items-center justify-center w-8 h-8 rounded-full border ${UI_COLORS.accent.border} dark:${UI_COLORS.accent.darkBorder} ${UI_COLORS.accent.bg} dark:${UI_COLORS.accent.darkBg}`}
          >
            {icon}
          </div>
          <h3 className="text-lg font-semibold">{title}</h3>
          {done && (
            <span
              className={`ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border ${UI_COLORS.success.border} dark:${UI_COLORS.success.darkBorder} ${UI_COLORS.success.bg} dark:${UI_COLORS.success.darkBg} ${UI_COLORS.success.text} dark:${UI_COLORS.success.darkText}`}
              aria-label="Done"
              title="Done"
            >
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </span>
          )}
          <ChevronDown
            className={`ml-auto w-4 h-4 text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {/* Content without animation */}
      {isExpanded && (
        <div
          id={`step-${stepId}-panel`}
          className="mt-2"
        >
          {children}
        </div>
      )}
    </div>
  );
};

export default PrepStepCard;


