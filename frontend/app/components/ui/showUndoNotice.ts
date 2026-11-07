import { toast, type Action, type ExternalToast } from 'sonner';

type UndoNotice = Pick<ExternalToast, 'duration' | 'position'> & {
  kind: 'success' | 'message';
  message: string;
  label: string;
  saving: string;
  onUndo: () => Promise<void>;
  failureMessage: (error: unknown) => string;
};

/** A transient action stays visible until its command has a local receipt. */
export function showUndoNotice({ kind, message, label, saving, onUndo, failureMessage, ...options }: UndoNotice) {
  let pending = false;
  const action: Action = {
    label,
    onClick: async event => {
      // Sonner dismisses the toast as soon as this handler returns.
      event.preventDefault();
      if (pending) return;
      pending = true;
      const warnBeforeUnload = (unload: BeforeUnloadEvent) => {
        unload.preventDefault();
        unload.returnValue = ' ';
      };
      window.addEventListener('beforeunload', warnBeforeUnload);
      try {
        toast.loading(saving, { id, position: options.position, action: undefined, dismissible: false });
        await onUndo();
        toast.dismiss(id);
      } catch (error) {
        toast.error(failureMessage(error), { ...options, id, action, dismissible: true });
      } finally {
        window.removeEventListener('beforeunload', warnBeforeUnload);
        pending = false;
      }
    },
  };
  const id = toast[kind](message, { ...options, action });
}
