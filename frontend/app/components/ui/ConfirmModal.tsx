"use client";

import { Dialog, DialogBackdrop, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

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

    return (
        <Transition show={isOpen} as={Fragment}>
            <Dialog className="relative z-50" onClose={onClose}>
                <TransitionChild
                    as={Fragment}
                    enter="ease-out duration-300"
                    enterFrom="opacity-0"
                    enterTo="opacity-100"
                    leave="ease-in duration-200"
                    leaveFrom="opacity-100"
                    leaveTo="opacity-0"
                >
                    <DialogBackdrop className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm transition-opacity" />
                </TransitionChild>

                <div className="fixed inset-0 z-10 w-screen overflow-y-auto">
                    <div className="flex min-h-full items-center justify-center p-4 text-center sm:p-0">
                        <TransitionChild
                            as={Fragment}
                            enter="ease-out duration-300"
                            enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
                            enterTo="opacity-100 translate-y-0 sm:scale-100"
                            leave="ease-in duration-200"
                            leaveFrom="opacity-100 translate-y-0 sm:scale-100"
                            leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
                        >
                            <DialogPanel className="relative overflow-hidden rounded-2xl bg-white px-4 pb-4 pt-5 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg sm:p-6 dark:bg-gray-800">
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
                                        <DialogTitle as="h3" className="text-lg font-semibold leading-6 text-gray-900 dark:text-gray-100">
                                            {title}
                                        </DialogTitle>
                                        {description && (
                                            <div className="mt-2">
                                                <p className="text-sm text-gray-500 dark:text-gray-400">
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
                                    <button
                                        type="button"
                                        disabled={isDeleting}
                                        className="mt-3 inline-flex w-full justify-center rounded-xl bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:mt-0 sm:w-auto transition disabled:opacity-60 dark:bg-gray-900 dark:text-gray-200 dark:ring-gray-700 dark:hover:bg-gray-800"
                                        onClick={onClose}
                                    >
                                        {cancelText || t('common.cancel', { defaultValue: 'Cancel' })}
                                    </button>
                                </div>
                            </DialogPanel>
                        </TransitionChild>
                    </div>
                </div>
            </Dialog>
        </Transition>
    );
}
