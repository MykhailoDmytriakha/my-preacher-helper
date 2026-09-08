'use client';

import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useClipboard } from '@/hooks/useClipboard';
import { buildDiagnosticReport, diagnosticServerVersion } from '@/utils/appDiagnostics';

/** One shared viewer for feedback and freshness warnings; copying never submits feedback. */
const OPEN_EVENT = 'preacher:open-developer-information';

export function TechnicalDetailsButton() {
  const { t } = useTranslation();
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
      {t('diagnostics.open')}
    </button>
  );
}

/** Owned by the layout: recovery may remove the warning that opened this viewer. */
export function TechnicalDetailsDialog() {

  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState('');
  const [collecting, setCollecting] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, show);
    return () => window.removeEventListener(OPEN_EVENT, show);
  }, []);
  const { isCopied, error: copyError, copyToClipboard, reset } = useClipboard({ successDuration: 3000 });
  useEffect(() => {
    reset();
    if (!open) return;
    let active = true;
    const snapshot = buildDiagnosticReport();
    setCollecting(true);
    setReport(JSON.stringify({ ...snapshot, server: { status: 'checking', version: null } }, null, 2));
    void diagnosticServerVersion().then(server => {
      if (active) {
        setReport(JSON.stringify({ ...buildDiagnosticReport(), server }, null, 2));
        setCollecting(false);
      }
    });
    return () => { active = false; };
  }, [open, reset]);
  return (
    <>
      <Dialog open={open} onClose={() => setOpen(false)} className="relative z-[200]">
        <DialogBackdrop className="fixed inset-0 bg-slate-950/60" />
        <div className="fixed inset-0 flex items-center justify-center p-3 sm:p-6">
          <DialogPanel className="flex max-h-[90dvh] w-full max-w-3xl flex-col rounded-2xl bg-white p-4 shadow-xl dark:bg-gray-900 sm:p-6">
            <DialogTitle className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('diagnostics.title')}</DialogTitle>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{t('diagnostics.description')}</p>
            <textarea aria-label={t('diagnostics.report')} readOnly value={report} spellCheck={false} className="mt-4 min-h-0 flex-1 resize-none rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200" rows={18} />
            <p role="status" className="mt-2 text-sm text-slate-600 dark:text-slate-300">{copyError ? t('diagnostics.copyFailed') : t('diagnostics.localOnly')}</p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm dark:text-slate-100">{t('common.close')}</button>
              <button type="button" onClick={() => { void copyToClipboard(report); }} disabled={collecting} className={`grid items-center rounded-lg px-4 py-2 text-center text-sm font-medium text-white transition-colors ${isCopied ? 'bg-green-600' : 'bg-blue-600'}`}>
                <span aria-hidden="true" className="invisible col-start-1 row-start-1">{t('diagnostics.copy')}</span>
                <span aria-live="polite" className="col-start-1 row-start-1">{t(collecting ? 'diagnostics.collecting' : isCopied ? 'diagnostics.copied' : 'diagnostics.copy')}</span>
              </button>
            </div>
          </DialogPanel>
        </div>
      </Dialog>
    </>
  );
}
