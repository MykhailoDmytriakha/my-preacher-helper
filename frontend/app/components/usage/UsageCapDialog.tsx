'use client';

import { Dialog, DialogBackdrop, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react';
import { SparklesIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

import { formatUsageResetDate } from '@/utils/usageGrace';

import type { UsageResource } from '@/services/usageLimits';

export interface UsageCapDialogProps {
  open: boolean;
  resource: UsageResource;
  resetsAt: string;
  verse: string;
  onClose: () => void;
}

const metricLabelKey: Record<UsageResource, string> = {
  ai: 'usageGrace.metrics.ai',
  transcription: 'usageGrace.metrics.transcription',
  audio: 'usageGrace.metrics.audio',
};

/**
 * THE ONE MOMENT THAT MUST NOT ARRIVE AS A TOAST.
 *
 * Being refused is the only usage message that stops the person mid-sentence, and it was
 * told in the most fleeting form the app has: a toast, stacked under ANOTHER toast carrying
 * the raw `Usage cap reached for ai` from the error object. The good words sat below the
 * fold and had to be hovered to be read at all, and then both timed out and were gone.
 *
 * So it is a dialog: the page dims, the words hold still until they are read, and the one
 * thing that can be done about it is a button rather than a sentence. The tone stays the
 * product's own — this is grace running out, not a fault — so no alarm colour and no
 * warning mark, and the verse is part of the message rather than a footnote to it.
 */
export default function UsageCapDialog({ open, resource, resetsAt, verse, onClose }: UsageCapDialogProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';

  return (
    <Transition show={open} as={Fragment}>
      <Dialog className="relative z-[120]" onClose={onClose}>
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <DialogBackdrop className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity" />
        </TransitionChild>

        <div className="fixed inset-0 z-10 w-screen overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <DialogPanel
                className="w-full max-w-md overflow-hidden rounded-3xl bg-white p-6 text-center shadow-2xl transition-all dark:bg-slate-900 sm:p-7"
                data-testid="usage-cap-dialog"
              >
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-sm">
                  <SparklesIcon aria-hidden="true" className="h-7 w-7 text-white" />
                </div>

                <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-300">
                  {t(metricLabelKey[resource])}
                </p>
                <DialogTitle as="h2" className="mt-1 text-xl font-semibold text-slate-900 dark:text-white">
                  {t('usageGrace.capDialog.title')}
                </DialogTitle>

                <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  {t('usageGrace.hardCap', { date: formatUsageResetDate(resetsAt, locale) })}
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  {t('usageGrace.softExpansion')}
                </p>

                {verse && (
                  <p
                    className="mt-5 rounded-2xl bg-violet-50 px-4 py-3 text-sm italic leading-6 text-violet-900 dark:bg-violet-950/40 dark:text-violet-100"
                    data-testid="usage-cap-dialog-verse"
                  >
                    {verse}
                  </p>
                )}

                <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
                  <Link
                    href="/settings/limits"
                    onClick={onClose}
                    className="inline-flex w-full items-center justify-center whitespace-nowrap rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:from-violet-500 hover:to-fuchsia-500 sm:w-auto"
                  >
                    {t('usageGrace.openSettings')}
                  </Link>
                  <button
                    type="button"
                    onClick={onClose}
                    className="inline-flex w-full items-center justify-center whitespace-nowrap rounded-xl px-5 py-3 text-sm font-semibold text-slate-600 ring-1 ring-inset ring-slate-200 transition hover:bg-slate-50 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800 sm:w-auto"
                  >
                    {t('usageGrace.capDialog.dismiss')}
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
