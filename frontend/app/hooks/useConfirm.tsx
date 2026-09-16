'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import ConfirmModal from '@/components/ui/ConfirmModal';

/**
 * "ARE YOU SURE?" AS AN AWAITABLE QUESTION, in the app's own window.
 *
 * Nine places asked it with `window.confirm`: the browser's own box, which on an iPhone looks
 * like a system alert from somewhere else, blocks the whole page (and every automated check of
 * it), and carried whatever words each place happened to write — one of them hard-coded in
 * Russian for every interface language.
 *
 * `window.confirm` answers synchronously; a window answers later. So the question is a promise:
 *
 *   const { confirm, confirmDialog } = useConfirm();
 *   if (!(await confirm({ title: t('…') }))) return;
 *   …
 *   return <>{…}{confirmDialog}</>;
 *
 * No provider: each component owns its question and renders its own window, so nothing global
 * can leave a promise hanging, and a test sees the real window rather than a stubbed alert.
 */
export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  /** Red and with a warning icon. On by default: this question is almost always before a deletion. */
  destructive?: boolean;
}

type Pending = ConfirmOptions & { resolve: (answer: boolean) => void };

export function useConfirm(): {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  confirmDialog: React.ReactElement;
} {
  const [request, setRequest] = useState<Pending | null>(null);
  // The live request, outside state: resolving inside a state updater would run twice.
  const pending = useRef<Pending | null>(null);

  const settle = useCallback((answer: boolean) => {
    const current = pending.current;
    pending.current = null;
    setRequest(null);
    current?.resolve(answer);
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => {
    // A second question while the first is open withdraws the first — it is answered "no",
    // never left waiting for ever.
    pending.current?.resolve(false);
    return new Promise<boolean>((resolve) => {
      const next = { ...options, resolve };
      pending.current = next;
      setRequest(next);
    });
  }, []);

  // A component that leaves while it is asking has its question answered "no".
  useEffect(() => () => pending.current?.resolve(false), []);

  const confirmDialog = (
    <ConfirmModal
      isOpen={request !== null}
      title={request?.title ?? ''}
      description={request?.description}
      confirmText={request?.confirmText}
      cancelText={request?.cancelText}
      isDestructive={request?.destructive ?? true}
      onConfirm={() => settle(true)}
      onClose={() => settle(false)}
    />
  );

  return { confirm, confirmDialog };
}

export default useConfirm;
