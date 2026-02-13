'use client';

import { XMarkIcon } from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';

import { GroupBlockStatus, GroupBlockTemplate, GroupFlowItem } from '@/models/models';

const STATUS_OPTIONS: Array<{ value: GroupBlockStatus; labelKey: string; fallback: string; color: string }> = [
    { value: 'empty', labelKey: 'groupFlow.status.empty', fallback: 'Empty', color: 'bg-gray-300' },
    { value: 'draft', labelKey: 'groupFlow.status.draft', fallback: 'Draft', color: 'bg-amber-400' },
    { value: 'filled', labelKey: 'groupFlow.status.filled', fallback: 'Filled', color: 'bg-emerald-500' },
];

interface FlowEditorProps {
    flowItem: GroupFlowItem;
    template: GroupBlockTemplate;
    onUpdateTemplate: (updates: Partial<GroupBlockTemplate>) => void;
    onUpdateFlowItem: (updates: Partial<GroupFlowItem>) => void;
    onClose: () => void;
}

export default function FlowEditor({
    flowItem,
    template,
    onUpdateTemplate,
    onUpdateFlowItem,
    onClose,
}: FlowEditorProps) {
    const { t } = useTranslation();

    return (
        <>
            {/* Mobile backdrop */}
            <div
                className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm xl:hidden"
                onClick={onClose}
                role="presentation"
            />

            {/* Panel — side on desktop, bottom sheet on mobile */}
            <div className="fixed bottom-0 left-0 right-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-700 dark:bg-gray-900 xl:static xl:z-auto xl:max-h-none xl:rounded-2xl xl:border xl:border-gray-200 xl:shadow-sm xl:dark:border-gray-800">
                {/* Header */}
                <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                        {flowItem.instanceTitle || template.title}
                    </h3>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                        aria-label="Close editor"
                    >
                        <XMarkIcon className="h-5 w-5" />
                    </button>
                </div>

                {/* Status selector */}
                <div className="mb-4">
                    <label htmlFor="block-status" className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
                        {t('groupFlow.editor.statusLabel', { defaultValue: 'Status' })}
                    </label>
                    <div id="block-status" className="flex gap-1.5">
                        {STATUS_OPTIONS.map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => onUpdateTemplate({ status: option.value })}
                                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${template.status === option.value
                                    ? 'bg-gray-100 text-gray-900 ring-1 ring-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:ring-gray-600'
                                    : 'text-gray-500 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800'
                                    }`}
                            >
                                <span className={`block h-2.5 w-2.5 rounded-full ${option.color}`} />
                                {t(option.labelKey, { defaultValue: option.fallback })}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Title */}
                <div className="mb-4">
                    <label htmlFor="block-title" className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
                        {t('groupFlow.editor.blockTitleLabel', { defaultValue: 'Block Name' })}
                    </label>
                    <input
                        id="block-title"
                        value={template.title}
                        onChange={(event) => onUpdateTemplate({ title: event.target.value })}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                    />
                </div>

                {/* Content */}
                <div className="mb-4">
                    <label htmlFor="block-content" className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
                        {t('groupFlow.editor.contentLabel', { defaultValue: 'Content' })}
                    </label>
                    <textarea
                        id="block-content"
                        value={template.content}
                        onChange={(event) => onUpdateTemplate({ content: event.target.value })}
                        rows={6}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                        placeholder={t('groupFlow.editor.contentPlaceholder', {
                            defaultValue: 'Brief guidelines, key verses, or questions...',
                        })}
                    />
                </div>

                {/* Instance title (flow-specific) */}
                <div className="mb-4">
                    <label htmlFor="step-title" className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
                        {t('groupFlow.editor.stepTitleLabel', { defaultValue: 'Step title' })}
                    </label>
                    <input
                        id="step-title"
                        value={flowItem.instanceTitle || ''}
                        onChange={(event) =>
                            onUpdateFlowItem({ instanceTitle: event.target.value || undefined })
                        }
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                        placeholder={template.title}
                    />
                </div>

                {/* Duration */}
                <div className="mb-4">
                    <label htmlFor="step-duration" className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
                        {t('groupFlow.editor.durationLabel', { defaultValue: 'Duration (min)' })}
                    </label>
                    <input
                        id="step-duration"
                        type="number"
                        min={1}
                        value={flowItem.durationMin ?? ''}
                        onChange={(event) =>
                            onUpdateFlowItem({ durationMin: event.target.value ? Number(event.target.value) : null })
                        }
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                        placeholder="—"
                    />
                </div>

                {/* Notes */}
                <div>
                    <label htmlFor="step-notes" className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
                        {t('groupFlow.editor.notesLabel', { defaultValue: 'Leader Notes' })}
                    </label>
                    <textarea
                        id="step-notes"
                        value={flowItem.instanceNotes || ''}
                        onChange={(event) =>
                            onUpdateFlowItem({ instanceNotes: event.target.value || undefined })
                        }
                        rows={3}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                        placeholder={t('groupFlow.editor.notesPlaceholder', {
                            defaultValue: 'Private notes...',
                        })}
                    />
                </div>
            </div>
        </>
    );
}
