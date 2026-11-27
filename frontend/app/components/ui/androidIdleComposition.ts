import * as prosemirrorView from '@tiptap/pm/view';

import type { Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

const ANDROID_IDLE_MS = 5000;
const ANDROID_OBSERVER_DELAY_MS = 20;
const BACKSPACE = 'deleteContentBackward';

/** ProseMirror exposes its own completion routine at runtime, without public types. */
const finishComposition = (prosemirrorView as typeof prosemirrorView & {
  __endComposition?: (view: EditorView) => unknown;
}).__endComposition;

/**
 * The Android Chrome idle timeout is one-shot. It can run during the DOM observer's
 * deferred Backspace, when ProseMirror deliberately leaves the composition alone.
 */
export function androidIdleComposition(view: () => EditorView) {
  const agent = globalThis.navigator?.userAgent ?? '';
  if (!/Android \d/.test(agent) || !/Chrome\/\d+/.test(agent) || typeof finishComposition !== 'function') return;

  let epoch = 0;
  let idleAt: number | undefined;
  let deletion: { sawInput: boolean; admitted: boolean } | undefined;

  const end = () => {
    epoch++;
    idleAt = undefined;
    deletion = undefined;
  };

  return {
    activity: () => {
      end();
      const current = epoch;
      // handleDOMEvents precedes the view's own composition handler and timer.
      void Promise.resolve().then(() => {
        if (current === epoch && view().composing) idleAt = performance.now() + ANDROID_IDLE_MS;
      });
    },
    end,
    beforeInput: (event: InputEvent) => {
      const now = performance.now();
      deletion = event.inputType === BACKSPACE && idleAt !== undefined && view().composing
        && now >= idleAt - ANDROID_OBSERVER_DELAY_MS && now <= idleAt
        ? { sawInput: false, admitted: false } : undefined;
    },
    input: (event: InputEvent) => {
      if (!deletion || deletion.sawInput || event.inputType !== BACKSPACE) deletion = undefined;
      else deletion.sawInput = true;
    },
    observe: (transaction: Transaction) => {
      if (!deletion || idleAt === undefined || performance.now() < idleAt || !view().composing) return;
      const composition = transaction.getMeta('composition');
      if (typeof composition !== 'number' || composition <= 0 || !transaction.docChanged) return;
      // Native Backspace must be admitted as a deletion. A later replacement or
      // inserted paragraph is a different action, even if tagged as composition.
      if (transaction.doc.content.size < transaction.before.content.size
        && transaction.steps.every(step => {
          const { stepType, slice } = step.toJSON() as { stepType?: string; slice?: unknown };
          return stepType === 'replace' && slice === undefined;
        })) deletion.admitted = true;
      else deletion = undefined;
    },
    finishIfAdmitted: () => {
      if (!deletion?.admitted || !view().composing) return;
      deletion = undefined;
      finishComposition(view());
    },
  };
}
