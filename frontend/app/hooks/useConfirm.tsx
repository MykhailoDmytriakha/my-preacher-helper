'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ConfirmModal from '@/components/ui/ConfirmModal';
import { sayFailure, type FailureWords } from '@/utils/actionFailureMessage';

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
 *   if (!(await confirm({ title: { key: '…' } }))) return;
 *   …
 *   return <>{…}{confirmDialog}</>;
 *
 * No provider: each component owns its question and renders its own window, so nothing global
 * can leave a promise hanging, and a test sees the real window rather than a stubbed alert.
 *
 * `withdraw()` takes back a question that no longer applies — the thing it asked about changed
 * under it — and answers it "no".
 */
/**
 * What the window says, kept as words and said each time it is drawn: a language switched while
 * the question is open re-says it (BUG-20261006-confirm-dialog-text-frozen-on-language-switch).
 * The shape a kept failure uses, said by the same `sayFailure`.
 *
 * The question and its buttons are always the app's own words, so they take a key only — a
 * sentence translated before asking does not fit them. The description may be the person's own
 * text (the note about to be cleared), so it also takes `{ said }`.
 */
export type ConfirmKey = Extract<FailureWords, { key: string }>;
export type ConfirmWords = FailureWords;

export interface ConfirmOptions {
  title: ConfirmKey;
  description?: ConfirmWords;
  confirmText?: ConfirmKey;
  cancelText?: ConfirmKey;
  /** Red and with a warning icon. On by default: this question is almost always before a deletion. */
  destructive?: boolean;
}

type Pending = ConfirmOptions & { resolve: (answer: boolean) => void };

export function useConfirm(): {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  confirmDialog: React.ReactElement;
  withdraw: () => void;
} {
  const { t } = useTranslation();
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

  const withdraw = useCallback(() => {
    if (pending.current) settle(false);
  }, [settle]);

  // A component that leaves while it is asking has its question answered "no".
  useEffect(() => () => pending.current?.resolve(false), []);

  const say = (words: ConfirmWords | undefined) => (words ? sayFailure(words, t) : undefined);
  const confirmDialog = (
    <ConfirmModal
      isOpen={request !== null}
      title={say(request?.title) ?? ''}
      description={say(request?.description)}
      confirmText={say(request?.confirmText)}
      cancelText={say(request?.cancelText)}
      isDestructive={request?.destructive ?? true}
      onConfirm={() => settle(true)}
      onClose={() => settle(false)}
    />
  );

  return { confirm, confirmDialog, withdraw };
}

export default useConfirm;
