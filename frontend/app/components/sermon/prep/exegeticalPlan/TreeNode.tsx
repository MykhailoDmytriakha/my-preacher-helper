'use client';

import { X, CornerDownRight, ArrowDown, ChevronLeft, ChevronRight } from 'lucide-react';
import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import '@locales/i18n';
import type { TreeNodeProps } from './types';

const TreeNode: React.FC<TreeNodeProps> = ({
  node,
  depth = 0,
  index = 0,
  draftTitles,
  focusedId,
  onTitleChange,
  onFocus,
  onBlur,
  onRemove,
  onAddChild,
  onAddSibling,
  onPromote,
  onDemote,
  expand
}) => {
  const { t } = useTranslation();
  const isOpen = expand[node.id] ?? true;
  const currentValue = draftTitles[node.id] !== undefined ? draftTitles[node.id] : (node.title || '');
  const inputRef = useRef<HTMLInputElement>(null);

  // Generate marker based on depth and index
  const getMarker = (depth: number, index: number): string => {
    if (depth === 0) {
      return `${index + 1}.`;
    } else if (depth === 1) {
      return `${String.fromCharCode(97 + (index % 26))}.`;
    } else if (depth === 2) {
      return '—';
    }
    return '';
  };

  const marker = getMarker(depth, index);
  const hasMarker = marker !== '';

  const isFocused = focusedId === node.id;
  const hasChildren = isOpen && node.children && node.children.length > 0;
  const inputShouldFocus = focusedId === node.id;

  useEffect(() => {
    if (!inputRef.current) return;

    if (inputShouldFocus) {
      inputRef.current.setAttribute('autofocus', 'true');
      inputRef.current.focus();
    } else {
      inputRef.current.removeAttribute('autofocus');
    }
  }, [inputShouldFocus]);

  // Color scheme for different depth levels
  const getLineColor = (depth: number): string => {
    const colors = [
      'bg-blue-400 dark:bg-blue-500',      // depth 0: blue
      'bg-purple-400 dark:bg-purple-500',  // depth 1: purple
      'bg-green-400 dark:bg-green-500',    // depth 2: green
      'bg-amber-400 dark:bg-amber-500',    // depth 3: amber
      'bg-pink-400 dark:bg-pink-500',      // depth 4: pink
    ];
    return colors[depth % colors.length];
  };

  const lineColor = getLineColor(depth);

  const parentLineColor = depth > 0 ? getLineColor(depth - 1) : lineColor;

  return (
    <div className="relative" style={{ marginLeft: depth > 0 ? 20 : 0 }}>
      {/* Connecting lines */}
      {depth === 0 ? (
        /* Root level - just horizontal line from left edge */
        <div className={`absolute left-0 top-5 w-3 h-px ${lineColor}`} />
      ) : (
        /* Child levels - vertical from parent (parent color) + horizontal to input (own color) */
        <>
          <div className={`absolute left-[-20px] top-0 w-px h-5 ${parentLineColor}`} />
          <div className={`absolute left-[-20px] top-5 w-4 h-px ${parentLineColor}`} />
        </>
      )}

      <div className="group">
        <div className="relative">
          {hasMarker && (
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-medium text-gray-500 dark:text-gray-400 pointer-events-none">
              {marker}
            </span>
          )}
          <input
            ref={inputRef}
            value={currentValue}
            onChange={(e) => {
              const val = e.target.value;
              onTitleChange(node.id, val);
              setTimeout(() => {
                if (focusedId === node.id) {
                  inputRef.current?.focus();
                }
              }, 0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (e.metaKey || e.ctrlKey) {
                  onAddChild(node.id);
                } else {
                  onAddSibling(node.id);
                }
              } else if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowLeft') {
                e.preventDefault();
                if (depth > 0) onPromote(node.id);
              } else if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowRight') {
                e.preventDefault();
                if (index > 0) onDemote(node.id);
              }
            }}
            onFocus={() => onFocus(node.id)}
            onBlur={() => {
              if (focusedId === node.id) onBlur(node.id);
            }}
            autoFocus={inputShouldFocus}
            className={`w-full ${hasMarker ? 'pl-8' : 'pl-2.5'} pr-24 py-1.5 text-sm bg-white dark:bg-gray-800 border rounded-md outline-none transition-colors ${isFocused
              ? 'border-blue-500 dark:border-blue-400'
              : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
              } placeholder-gray-400 dark:placeholder-gray-500 text-gray-900 dark:text-gray-100`}
            placeholder={t('wizard.steps.exegeticalPlan.builder.placeholder') as string}
          />

          <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1">
            <button
              onClick={() => onPromote(node.id)}
              disabled={depth === 0}
              aria-label="outdent"
              title={t('wizard.steps.exegeticalPlan.builder.tooltips.promote') as string}
              className={`inline-flex items-center justify-center p-0.5 rounded transition-colors ${depth === 0
                ? 'text-gray-200 dark:text-gray-800 cursor-not-allowed'
                : 'text-gray-400 dark:text-gray-500 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                }`}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <button
              onClick={() => onDemote(node.id)}
              disabled={index === 0}
              aria-label="indent"
              title={t('wizard.steps.exegeticalPlan.builder.tooltips.demote') as string}
              className={`inline-flex items-center justify-center p-0.5 rounded transition-colors ${index === 0
                ? 'text-gray-200 dark:text-gray-800 cursor-not-allowed'
                : 'text-gray-400 dark:text-gray-500 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                }`}
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            <div className="w-px h-3 bg-gray-200 dark:bg-gray-700 mx-0.5"></div>

            <button
              onClick={() => onAddChild(node.id)}
              aria-label="add child"
              title={`${t('wizard.steps.exegeticalPlan.builder.tooltips.addChild')} (⌘+Enter)`}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
            >
              <CornerDownRight className="w-3 h-3" />
              <span className="sr-only sm:not-sr-only">Sub</span>
            </button>

            <button
              onClick={() => onAddSibling(node.id)}
              aria-label="add sibling"
              title={`${t('wizard.steps.exegeticalPlan.builder.tooltips.addSibling')} (Enter)`}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] text-gray-400 dark:text-gray-500 hover:text-green-600 dark:hover:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded transition-colors"
            >
              <ArrowDown className="w-3 h-3" />
              <span className="sr-only sm:not-sr-only">Next</span>
            </button>

            <div className="w-px h-3 bg-gray-200 dark:bg-gray-700 mx-0.5"></div>

            <button
              onClick={() => onRemove(node.id)}
              aria-label="delete"
              title={t('wizard.steps.exegeticalPlan.builder.tooltips.delete') as string}
              className="w-5 h-5 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 flex items-center justify-center transition-all"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {hasChildren && (
        <div className="relative mt-1">
          <div className="pl-0 space-y-1">
            {node.children!.map((child, childIndex) => {
              const isLast = childIndex === node.children!.length - 1;
              return (
                <div key={child.id} className="relative">
                  {/* Vertical line connecting siblings - use PARENT color for consistency */}
                  {!isLast && (
                    <div className={`absolute left-0 top-0 bottom-[-4px] w-px ${lineColor}`} />
                  )}
                  <TreeNode
                    node={child}
                    depth={depth + 1}
                    index={childIndex}
                    draftTitles={draftTitles}
                    focusedId={focusedId}
                    onTitleChange={onTitleChange}
                    onFocus={onFocus}
                    onBlur={onBlur}
                    onRemove={onRemove}
                    onAddChild={onAddChild}
                    onAddSibling={onAddSibling}
                    onPromote={onPromote}
                    onDemote={onDemote}
                    expand={expand}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default TreeNode;
