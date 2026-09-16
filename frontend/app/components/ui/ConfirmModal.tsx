"use client";

import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { useId } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useModalLayer } from '@/hooks/useModalLayer';

interface ConfirmModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    description?: string;
    confirmText?: string;
    cancelText?: string;
    isDestructive?: boolean;
    isDeleting?: boolean;
    children?: React.ReactNode;
    confirmDisabled?: boolean;
}

/**
 * "ARE YOU SURE?" — one window for the whole app.
 *
 * It used to be built on a third-party dialog, which kept its own idea of which window is on
 * top. Opened over one of our forms, that meant two things: it was drawn BELOW the form (its
 * layer was lower), and one press of Escape closed both — the question and the form it was
 * asked from. It now stands in the same stack as every other window (`useModalLayer`), above
 * all of them, and only it answers Escape while it is open.
 *
 * The look is unchanged on purpose: the same icon, the same buttons, the same words.
 */
export default function ConfirmModal({
    isOpen,
    onClose,
    onConfirm,
    title,
    description,
    confirmText,
    cancelText,
    isDestructive = true,
    isDeleting = false,
    children,
    confirmDisabled = false,
}: ConfirmModalProps) {
    const { t } = useTranslation();
    const titleId = useId();
    const descriptionId = useId();
    const layer = useModalLayer({ onClose, active: isOpen, closeDisabled: isDeleting });

    if (!isOpen || typeof document === 'undefined') return null;

    return createPortal(
        <div
            {...layer}
            className="fixed inset-0 z-[300] overflow-y-auto overscroll-contain"
        >
            <div
                className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm animate-fadeIn"
                aria-hidden="true"
                onClick={() => { if (!isDeleting) onClose(); }}
            />
            <div className="flex min-h-full items-center justify-center p-4 text-center sm:p-0">
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby={titleId}
                    aria-describedby={description ? descriptionId : undefined}
                    className="relative w-full overflow-hidden rounded-2xl bg-white px-4 pb-4 pt-5 text-left shadow-xl animate-fadeIn sm:my-8 sm:max-w-lg sm:p-6 dark:bg-gray-800"
                >
                    <div className="sm:flex sm:items-start">
                        {isDestructive && (
                            <div className="mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10 dark:bg-red-900/40">
                                <ExclamationTriangleIcon
                                    className="h-6 w-6 text-red-600 dark:text-red-400"
                                    aria-hidden="true"
                                />
                            </div>
                        )}
                        <div className={`mt-3 text-center sm:ml-4 sm:mt-0 sm:text-left ${!isDestructive && 'sm:ml-0'}`}>
                            <h3 id={titleId} className="text-lg font-semibold leading-6 text-gray-900 dark:text-gray-100">
                                {title}
                            </h3>
                            {description && (
                                <div className="mt-2">
                                    <p id={descriptionId} className="text-sm text-gray-500 dark:text-gray-400">
                                        {description}
                                    </p>
                                </div>
                            )}
                            {children && (
                                <div className="mt-4">
                                    {children}
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse">
                        <button
                            type="button"
                            disabled={isDeleting || confirmDisabled}
                            className={`inline-flex w-full justify-center rounded-xl px-3 py-2 text-sm font-semibold text-white shadow-sm sm:ml-3 sm:w-auto transition disabled:opacity-60 disabled:cursor-not-allowed ${isDestructive
                                ? 'bg-red-600 hover:bg-red-500'
                                : 'bg-emerald-600 hover:bg-emerald-500'
                                }`}
                            onClick={onConfirm}
                        >
                            {isDeleting
                                ? t('common.deleting', { defaultValue: 'Deleting...' })
                                : confirmText || t('common.confirm', { defaultValue: 'Confirm' })}
                        </button>
                        {/*
                          Focus starts on the way OUT. The question is asked before something that
                          cannot be undone, and a stray Enter must answer "no", not "yes".
                        */}
                        <button
                            type="button"
                            autoFocus
                            disabled={isDeleting}
                            className="mt-3 inline-flex w-full justify-center rounded-xl bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:mt-0 sm:w-auto transition disabled:opacity-60 dark:bg-gray-900 dark:text-gray-200 dark:ring-gray-700 dark:hover:bg-gray-800"
                            onClick={onClose}
                        >
                            {cancelText || t('common.cancel', { defaultValue: 'Cancel' })}
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}
