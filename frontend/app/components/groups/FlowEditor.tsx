'use client';

import { XMarkIcon } from '@heroicons/react/24/outline';
import { useId } from 'react';

import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useModalLayer } from '@/hooks/useModalLayer';
import { GroupBlockStatus, GroupBlockTemplate, GroupFlowItem } from '@/models/models';
import { isGroupBlockStatus } from '@/utils/groupDocument';
import { useTranslation } from '@locales/useTranslation';

import { LiveTextInput, LiveTextArea } from '../ui/LiveTextInput';
import { RichMarkdownEditor } from '../ui/RichMarkdownEditor';

import { GroupFlowFieldHistory } from './GroupFlowFieldHistory';

import type { GroupPageEditor } from '@/hooks/groupPageEditor';

const STATUS_OPTIONS: Array<{ value: GroupBlockStatus; labelKey: string; fallback: string; color: string }> = [
    { value: 'empty', labelKey: 'groupFlow.status.empty', fallback: 'Empty', color: 'bg-gray-300' },
    { value: 'draft', labelKey: 'groupFlow.status.draft', fallback: 'Draft', color: 'bg-amber-400' },
    { value: 'filled', labelKey: 'groupFlow.status.filled', fallback: 'Filled', color: 'bg-emerald-500' },
];

interface FlowEditorProps {
    flowItem: GroupFlowItem;
    template: GroupBlockTemplate;
    onUpdateTemplate: (updates: Partial<GroupBlockTemplate>) => void;
    titleScope?: GroupPageEditor['flowTitleScope'];
    onRenameBlock: (title: string) => Promise<void>;
    onSetStatus: (status: GroupBlockStatus) => Promise<void>;
    onSetDuration: (duration: number | null) => Promise<void>;
    onRenameStep: (title: string | null) => Promise<void>;
    onUpdateFlowItem: (updates: Partial<GroupFlowItem>) => void;
    onClose: () => void;
}

export default function FlowEditor({
    flowItem,
    template,
    onUpdateTemplate,
    titleScope,
    onRenameBlock,
    onSetStatus,
    onSetDuration,
    onRenameStep,
    onUpdateFlowItem,
    onClose,
}: FlowEditorProps) {
    const { t } = useTranslation();
    const titleId = useId();
    const modal = !useMediaQuery('(min-width: 1280px)');
    const layer = useModalLayer({ active: modal, onClose });

    return (
        <>
            {/* Mobile backdrop - only needed if not full screen, but we'll keep it for transitions if any */}
            <div
                className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm xl:hidden"
                onClick={onClose}
                role="presentation"
            />

            {/* Panel — full screen on mobile, a side panel on desktop. The header stays put and the
                fields scroll in their own area, which never hands the wheel over to the page: on
                desktop the panel is bounded by the page (--flow-editor-max-h) instead of growing
                past the window, where it froze under the nav while the other column scrolled. */}
            <div {...layer} role={modal ? 'dialog' : undefined} aria-modal={modal || undefined}
                aria-labelledby={modal ? titleId : undefined}
                className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-gray-900 xl:static xl:z-auto xl:max-h-[var(--flow-editor-max-h,calc(100dvh-2rem))] xl:rounded-2xl xl:border xl:border-gray-200 xl:shadow-sm xl:dark:border-gray-800">
                {/* Header */}
                <div className="flex shrink-0 items-center justify-between gap-3 px-5 pb-6 pt-5">
                    <h3 id={titleId} className="min-w-0 flex-1 break-words text-lg font-bold text-gray-900 dark:text-gray-100 xl:text-base xl:font-semibold">
                        {flowItem.instanceTitle || template.title}
                    </h3>
                    <button
                        type="button"
                        onClick={onClose}
                        className="shrink-0 rounded-xl p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300 xl:rounded-lg xl:p-1.5"
                        aria-label={t('common.close')}
                    >
                        <XMarkIcon className="h-6 w-6 xl:h-5 xl:w-5" />
                    </button>
                </div>

                <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 pb-5">
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
                                    aria-pressed={template.status === option.value}
                                    onClick={() => { void onSetStatus(option.value).catch(() => undefined); }}
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

                    {titleScope && <GroupFlowFieldHistory key={JSON.stringify([titleScope.generation, template.id, template.createdAt])}
                        scope={titleScope} field="status" rowId={template.id} rowCreatedAt={template.createdAt}
                        current={template.status} onRestore={value => isGroupBlockStatus(value) ? onSetStatus(value) : Promise.reject(new Error('Invalid block status'))} />}

                    {/* Title */}
                    <div>
                        <label htmlFor="block-title" className="mb-2 block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                            {t('groupFlow.editor.blockTitleLabel', { defaultValue: 'Block Name (Template)' })}
                        </label>
                        <LiveTextInput
                            id="block-title"
                            value={template.title}
                            onChange={(value) => { void onRenameBlock(value).catch(() => undefined); }}
                            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-800 transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 xl:rounded-lg xl:px-3 xl:py-2"
                        />
                        {titleScope && <GroupFlowFieldHistory key={JSON.stringify([titleScope.generation, template.id, template.createdAt])}
                            scope={titleScope} field="block" rowId={template.id} rowCreatedAt={template.createdAt} current={template.title}
                            onRestore={value => onRenameBlock(typeof value === 'string' ? value : '')} />}
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
                        <LiveTextInput
                            id="step-title"
                            value={flowItem.instanceTitle || ''}
                            onChange={(value) => { void onRenameStep(value || null).catch(() => undefined); }}
                            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 xl:rounded-lg xl:px-3 xl:py-2"
                            placeholder={template.title}
                        />
                        {titleScope && <GroupFlowFieldHistory key={JSON.stringify([titleScope.generation, flowItem.id, flowItem.templateId])}
                            scope={titleScope} field="step" rowId={flowItem.id} rowCreatedAt={flowItem.templateId}
                            current={flowItem.instanceTitle ?? null} onRestore={value => onRenameStep(typeof value === 'string' ? value : null)} />}
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
                            onChange={(event) => {
                                const duration = event.target.value ? Number(event.target.value) : null;
                                void onSetDuration(duration).catch(() => undefined);
                            }}
                            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 xl:rounded-lg xl:px-3 xl:py-2"
                            placeholder="—"
                        />
                    </div>

                    {titleScope && <GroupFlowFieldHistory key={JSON.stringify([titleScope.generation, flowItem.id, flowItem.templateId])}
                        scope={titleScope} field="duration" rowId={flowItem.id} rowCreatedAt={flowItem.templateId}
                        current={flowItem.durationMin ?? null} onRestore={value => value === null || typeof value === 'number'
                            ? onSetDuration(value) : Promise.reject(new Error('Invalid step duration'))} />}

                    {/* Notes */}
                    <div>
                        <label htmlFor="step-notes" className="mb-2 block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                            {t('groupFlow.editor.notesLabel', { defaultValue: 'Leader Notes' })}
                        </label>
                        <LiveTextArea
                            id="step-notes"
                            value={flowItem.instanceNotes || ''}
                            onChange={(value) =>
                                onUpdateFlowItem({ instanceNotes: value || undefined })
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
