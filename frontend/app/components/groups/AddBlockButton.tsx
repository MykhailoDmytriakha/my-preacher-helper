'use client';

import {
    ArrowsUpDownIcon,
    ChevronDownIcon,
    PlusIcon,
} from '@heroicons/react/24/outline';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { GroupBlockTemplateType } from '@/models/models';

const TEMPLATE_OPTIONS: Array<{ type: GroupBlockTemplateType; labelKey: string; fallback: string }> = [
    { type: 'topic', labelKey: 'groupFlow.types.topic', fallback: 'Main topic' },
    { type: 'scripture', labelKey: 'groupFlow.types.scripture', fallback: 'Scripture' },
    { type: 'questions', labelKey: 'groupFlow.types.questions', fallback: 'Questions' },
    { type: 'announcement', labelKey: 'groupFlow.types.announcement', fallback: 'Announcement' },
    { type: 'explanation', labelKey: 'groupFlow.types.explanation', fallback: 'Explanation' },
    { type: 'notes', labelKey: 'groupFlow.types.notes', fallback: 'Notes' },
    { type: 'prayer', labelKey: 'groupFlow.types.prayer', fallback: 'Prayer' },
    { type: 'custom', labelKey: 'groupFlow.types.custom', fallback: 'Custom Block' },
];

interface AddBlockButtonProps {
    onAdd: (type: GroupBlockTemplateType) => void;
}

export default function AddBlockButton({ onAdd }: AddBlockButtonProps) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    const close = useCallback(() => setOpen(false), []);

    useEffect(() => {
        if (!open) return;
        const handleClick = (event: MouseEvent) => {
            if (ref.current && !ref.current.contains(event.target as Node)) close();
        };
        const handleKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') close();
        };
        document.addEventListener('mousedown', handleClick);
        document.addEventListener('keydown', handleKey);
        return () => {
            document.removeEventListener('mousedown', handleClick);
            document.removeEventListener('keydown', handleKey);
        };
    }, [open, close]);

    return (
        <div ref={ref} className="relative inline-block">
            <button
                type="button"
                onClick={() => setOpen((prev) => !prev)}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 active:scale-[0.98]"
            >
                <PlusIcon className="h-4 w-4" />
                {t('groupFlow.addBlock', { defaultValue: 'Add block' })}
                <ChevronDownIcon className={`h-3.5 w-3.5 transition ${open ? 'rotate-180' : ''}`} />
            </button>

            {open && (
                <div className="absolute left-0 top-full z-20 mt-2 w-52 rounded-xl border border-gray-200 bg-white py-1.5 shadow-xl dark:border-gray-700 dark:bg-gray-800">
                    {TEMPLATE_OPTIONS.map((option) => (
                        <button
                            key={option.type}
                            type="button"
                            onClick={() => {
                                onAdd(option.type);
                                close();
                            }}
                            className="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm text-gray-700 transition hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700"
                        >
                            <ArrowsUpDownIcon className="h-3.5 w-3.5 text-gray-400" />
                            {t(option.labelKey, { defaultValue: option.fallback })}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
