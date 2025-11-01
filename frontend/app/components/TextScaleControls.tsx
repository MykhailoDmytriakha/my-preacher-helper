'use client';

import React from 'react';
import { useTextScale } from '@/providers/TextScaleProvider';

interface TextScaleControlsProps {
  className?: string;
  showPercentage?: boolean;
}

const EPSILON = 0.01; // Tolerance for floating-point comparison

export const TextScaleControls: React.FC<TextScaleControlsProps> = ({ 
  className = '', 
  showPercentage = true 
}) => {
  const { 
    scale, 
    increaseScale, 
    decreaseScale, 
    resetScale, 
    scalePercentage,
    availableScales 
  } = useTextScale();

  // Use tolerance-based comparison for floating-point values
  const isAtMinScale = scale <= availableScales[0] + EPSILON;
  const isAtMaxScale = scale >= availableScales[availableScales.length - 1] - EPSILON;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {/* Decrease button */}
      <button
        onClick={decreaseScale}
        disabled={isAtMinScale}
        className="flex items-center justify-center w-10 h-10 px-2 py-1 text-sm font-semibold rounded-md transition-all duration-200 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
        title="Decrease text size (A-)"
        aria-label="Decrease text size"
      >
        A<span className="text-xs">−</span>
      </button>

      {/* Scale percentage display */}
      {showPercentage && (
        <div className="flex items-center justify-center min-w-12 px-2 py-1 text-sm font-medium rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200">
          {scalePercentage}%
        </div>
      )}

      {/* Increase button */}
      <button
        onClick={increaseScale}
        disabled={isAtMaxScale}
        className="flex items-center justify-center w-10 h-10 px-2 py-1 text-sm font-semibold rounded-md transition-all duration-200 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
        title="Increase text size (A+)"
        aria-label="Increase text size"
      >
        A<span className="text-xs">+</span>
      </button>

      {/* Reset button */}
      {scale !== 1 && (
        <button
          onClick={resetScale}
          className="ml-1 px-3 py-1 text-xs font-medium rounded-md transition-all duration-200 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/50"
          title="Reset text size to default"
          aria-label="Reset text size"
        >
          Reset
        </button>
      )}
    </div>
  );
};
