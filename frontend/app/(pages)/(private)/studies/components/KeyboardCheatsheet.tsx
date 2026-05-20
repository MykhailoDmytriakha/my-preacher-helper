'use client';

import { XMarkIcon } from '@heroicons/react/24/outline';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface KeyboardCheatsheetProps {
    open: boolean;
    onClose: () => void;
}

interface Shortcut {
    keys: string;
    descKey: string;
}

const SHORTCUTS: Shortcut[] = [
    { keys: 'Cmd/Ctrl + E', descKey: 'studiesWorkspace.cheatsheet.toggleEdit' },
    { keys: 'Enter', descKey: 'studiesWorkspace.cheatsheet.newSibling' },
    { keys: 'Cmd/Ctrl + Enter', descKey: 'studiesWorkspace.cheatsheet.newChild' },
    { keys: 'Tab', descKey: 'studiesWorkspace.cheatsheet.demote' },
    { keys: 'Shift + Tab', descKey: 'studiesWorkspace.cheatsheet.promote' },
    { keys: 'Cmd/Ctrl + ↑/↓', descKey: 'studiesWorkspace.cheatsheet.move' },
    { keys: 'Backspace', descKey: 'studiesWorkspace.cheatsheet.deleteEmpty' },
    { keys: 'Esc', descKey: 'studiesWorkspace.cheatsheet.exitEdit' },
    { keys: '← / →', descKey: 'studiesWorkspace.cheatsheet.prevNext' },
];

export function KeyboardCheatsheet({ open, onClose }: KeyboardCheatsheetProps) {
    const { t } = useTranslation();

    useEffect(() => {
        if (!open) return;
        const handleKeyDown = (e: globalThis.KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-gray-900/40 backdrop-blur-sm"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-labelledby="keyboard-cheatsheet-title"
        >
            <div
                className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-gray-700 dark:bg-gray-900"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="mb-4 flex items-center justify-between">
                    <h2 id="keyboard-cheatsheet-title" className="text-lg font-semibold text-gray-900 dark:text-gray-50">
                        {t('studiesWorkspace.cheatsheet.title')}
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-md p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"
                        aria-label={t('common.close') || 'Close'}
                    >
                        <XMarkIcon className="h-5 w-5" />
                    </button>
                </div>
                <ul className="space-y-2">
                    {SHORTCUTS.map((shortcut) => (
                        <li key={shortcut.keys} className="flex items-baseline justify-between gap-4 text-sm">
                            <span className="text-gray-700 dark:text-gray-200">{t(shortcut.descKey)}</span>
                            <kbd className="shrink-0 rounded-md border border-gray-300 bg-gray-50 px-2 py-0.5 text-xs font-mono text-gray-800 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100">
                                {shortcut.keys}
                            </kbd>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}

export default KeyboardCheatsheet;
