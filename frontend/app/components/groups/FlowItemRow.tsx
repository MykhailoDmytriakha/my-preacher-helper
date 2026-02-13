'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
    Bars3Icon,
    EllipsisVerticalIcon,
    TrashIcon,
    DocumentDuplicateIcon,
    ArrowUpIcon,
    ArrowDownIcon,
} from '@heroicons/react/24/outline';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { GroupBlockTemplate, GroupFlowItem } from '@/models/models';

const STATUS_COLORS: Record<string, { dot: string; label: string }> = {
    empty: { dot: 'bg-gray-300 dark:bg-gray-600', label: 'Empty' },
    draft: { dot: 'bg-amber-400 dark:bg-amber-500', label: 'Draft' },
    filled: { dot: 'bg-emerald-500 dark:bg-emerald-400', label: 'Filled' },
};

interface FlowItemRowProps {
    flowItem: GroupFlowItem;
    template: GroupBlockTemplate;
    index: number;
    isSelected: boolean;
    isFirst: boolean;
    isLast: boolean;
    onSelect: () => void;
    onStatusCycle: () => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
    onDuplicate: () => void;
    onDelete: () => void;
}

export default function FlowItemRow({
    flowItem,
    template,
    index,
    isSelected,
    isFirst,
    isLast,
    onSelect,
    onStatusCycle,
    onMoveUp,
    onMoveDown,
    onDuplicate,
    onDelete,
}: FlowItemRowProps) {
    const { t } = useTranslation();
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: flowItem.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        zIndex: isDragging ? 10 : 1,
    };

    const statusInfo = STATUS_COLORS[template.status];
    const displayTitle = flowItem.instanceTitle || template.title;
    const contentSnippet = template.content?.trim();

    const closeMenu = useCallback(() => setMenuOpen(false), []);

    useEffect(() => {
        if (!menuOpen) return;
        const handleClick = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) closeMenu();
        };
        const handleKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') closeMenu();
        };
        document.addEventListener('mousedown', handleClick);
        document.addEventListener('keydown', handleKey);
        return () => {
            document.removeEventListener('mousedown', handleClick);
            document.removeEventListener('keydown', handleKey);
        };
    }, [menuOpen, closeMenu]);

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            role="button"
            tabIndex={0}
            onClick={onSelect}
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect();
                }
            }}
            className={`group/item relative flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors cursor-pointer ${isSelected
                ? 'border-blue-300 bg-blue-50/60 shadow-sm ring-1 ring-blue-200 dark:border-blue-700 dark:bg-blue-950/30 dark:ring-blue-800'
                : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600'
                }`}
        >
            {/* Drag handle */}
            <div
                {...listeners}
                className="flex-shrink-0 cursor-grab text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 active:cursor-grabbing outline-none touch-none"
                onClick={(e) => e.stopPropagation()}
            >
                <Bars3Icon className="h-4 w-4" />
            </div>

            {/* Status dot — clickable cycle */}
            <button
                type="button"
                onClick={(event) => {
                    event.stopPropagation();
                    onStatusCycle();
                }}
                title={t(`groupFlow.status.${template.status}`, { defaultValue: statusInfo.label })}
                className="flex-shrink-0 group/dot relative"
            >
                <span className={`block h-3 w-3 rounded-full ${statusInfo.dot} transition-transform hover:scale-125 ring-2 ring-white dark:ring-gray-800`} />
            </button>

            {/* Number */}
            <span className="flex-shrink-0 text-xs font-bold text-gray-400 dark:text-gray-500 tabular-nums w-5 text-center">
                {index + 1}
            </span>

            {/* Content area */}
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">
                        {displayTitle}
                    </span>
                </div>
                {contentSnippet && (
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 truncate">
                        {contentSnippet}
                    </p>
                )}
            </div>

            {/* Duration badge */}
            {flowItem.durationMin && (
                <span className="flex-shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-200">
                    {flowItem.durationMin}{t('groupFlow.stats.duration', { defaultValue: 'm' })}
                </span>
            )}

            {/* Three-dot menu */}
            <div ref={menuRef} className="relative flex-shrink-0">
                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation();
                        setMenuOpen((prev) => !prev);
                    }}
                    className="rounded-lg p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 opacity-0 group-hover/item:opacity-100 focus:opacity-100 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                    aria-label={t('common.more', { defaultValue: 'More options' })}
                >
                    <EllipsisVerticalIcon className="h-5 w-5" />
                </button>

                {menuOpen && (
                    <div className="absolute right-0 top-full z-30 mt-1 w-44 rounded-xl border border-gray-200 bg-white py-1 shadow-xl dark:border-gray-700 dark:bg-gray-800">
                        {!isFirst && (
                            <button
                                type="button"
                                onClick={(event) => { event.stopPropagation(); closeMenu(); onMoveUp(); }}
                                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700"
                            >
                                <ArrowUpIcon className="h-4 w-4" />
                                {t('groupFlow.actions.moveUp', { defaultValue: 'Move up' })}
                            </button>
                        )}
                        {!isLast && (
                            <button
                                type="button"
                                onClick={(event) => { event.stopPropagation(); closeMenu(); onMoveDown(); }}
                                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700"
                            >
                                <ArrowDownIcon className="h-4 w-4" />
                                {t('groupFlow.actions.moveDown', { defaultValue: 'Move down' })}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={(event) => { event.stopPropagation(); closeMenu(); onDuplicate(); }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700"
                        >
                            <DocumentDuplicateIcon className="h-4 w-4" />
                            {t('groupFlow.actions.duplicate', { defaultValue: 'Duplicate' })}
                        </button>
                        <div className="my-1 border-t border-gray-100 dark:border-gray-700" />
                        <button
                            type="button"
                            onClick={(event) => { event.stopPropagation(); closeMenu(); onDelete(); }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                        >
                            <TrashIcon className="h-4 w-4" />
                            {t('groupFlow.actions.delete', { defaultValue: 'Delete' })}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
