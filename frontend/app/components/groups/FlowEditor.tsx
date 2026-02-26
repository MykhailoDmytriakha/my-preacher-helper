'use client';

import { XMarkIcon } from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';

import { GroupBlockStatus, GroupBlockTemplate, GroupFlowItem } from '@/models/models';

import { RichMarkdownEditor } from '../ui/RichMarkdownEditor';

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
            {/* Mobile backdrop - only needed if not full screen, but we'll keep it for transitions if any */}
            <div
                className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm xl:hidden"
                onClick={onClose}
                role="presentation"
            />

            {/* Panel — full screen on mobile, absolute side on desktop */}
            <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-white p-5 dark:bg-gray-900 xl:static xl:z-auto xl:block xl:max-h-none xl:rounded-2xl xl:border xl:border-gray-200 xl:shadow-sm xl:dark:border-gray-800">
                {/* Header */}
                <div className="mb-6 flex items-center justify-between">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 xl:text-base xl:font-semibold">
                        {flowItem.instanceTitle || template.title}
                    </h3>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-xl p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300 xl:rounded-lg xl:p-1.5"
                        aria-label="Close editor"
                    >
                        <XMarkIcon className="h-6 w-6 xl:h-5 xl:w-5" />
                    </button>
                </div>

                <div className="space-y-6">
                    {/* Status selector */}
                    <div>
                        <label htmlFor="block-status" className="mb-2 block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                            {t('groupFlow.editor.statusLabel', { defaultValue: 'Status' })}
                        </label>
                        <div id="block-status" className="flex flex-wrap gap-2">
                            {STATUS_OPTIONS.map((option) => (
                                <button
                                    key={option.value}
                                    type="button"
                                    onClick={() => onUpdateTemplate({ status: option.value })}
                                    className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition xl:rounded-lg xl:px-3 xl:py-1.5 xl:text-xs ${template.status === option.value
                                        ? 'bg-gray-100 text-gray-900 ring-1 ring-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:ring-gray-600'
                                        : 'text-gray-500 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800'
                                        }`}
                                >
                                    <span className={`block h-3 w-3 rounded-full xl:h-2.5 xl:w-2.5 ${option.color}`} />
                                    {t(option.labelKey, { defaultValue: option.fallback })}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Title */}
                    <div>
                        <label htmlFor="block-title" className="mb-2 block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                            {t('groupFlow.editor.blockTitleLabel', { defaultValue: 'Block Name (Template)' })}
                        </label>
                        <input
                            id="block-title"
                            value={template.title}
                            onChange={(event) => onUpdateTemplate({ title: event.target.value })}
                            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-800 transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 xl:rounded-lg xl:px-3 xl:py-2"
                        />
                    </div>

                    {/* Content */}
                    <div>
                        <label htmlFor="block-content" className="mb-2 block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                            {t('groupFlow.editor.contentLabel', { defaultValue: 'Content' })}
                        </label>
                        <RichMarkdownEditor
                            value={template.content}
                            onChange={(content) => onUpdateTemplate({ content })}
                            placeholder={t('groupFlow.editor.contentPlaceholder', {
                                defaultValue: 'Brief guidelines, key verses, or questions...',
                            })}
                            minHeight="200px"
                        />
                    </div>

                    {/* Instance title (flow-specific) */}
                    <div>
                        <label htmlFor="step-title" className="mb-2 block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                            {t('groupFlow.editor.stepTitleLabel', { defaultValue: 'Step title' })}
                        </label>
                        <input
                            id="step-title"
                            value={flowItem.instanceTitle || ''}
                            onChange={(event) =>
                                onUpdateFlowItem({ instanceTitle: event.target.value || undefined })
                            }
                            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 xl:rounded-lg xl:px-3 xl:py-2"
                            placeholder={template.title}
                        />
                    </div>

                    {/* Duration */}
                    <div>
                        <label htmlFor="step-duration" className="mb-2 block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
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
                            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 xl:rounded-lg xl:px-3 xl:py-2"
                            placeholder="—"
                        />
                    </div>

                    {/* Notes */}
                    <div>
                        <label htmlFor="step-notes" className="mb-2 block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                            {t('groupFlow.editor.notesLabel', { defaultValue: 'Leader Notes' })}
                        </label>
                        <textarea
                            id="step-notes"
                            value={flowItem.instanceNotes || ''}
                            onChange={(event) =>
                                onUpdateFlowItem({ instanceNotes: event.target.value || undefined })
                            }
                            rows={3}
                            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 xl:rounded-lg xl:px-3 xl:py-2"
                            placeholder={t('groupFlow.editor.notesPlaceholder', {
                                defaultValue: 'Private notes...',
                            })}
                        />
                    </div>
                </div>
            </div>
        </>
    );
}
