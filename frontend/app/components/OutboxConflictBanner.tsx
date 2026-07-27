'use client';

import { useQueryClient } from '@tanstack/react-query';
import { doc } from 'firebase/firestore';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { OUTBOX_CHANGED_EVENT } from '@/components/OutboxDrain';
import { SaveConflictBanner } from '@/components/SaveConflictBanner';
import { getClientDb } from '@/config/firebaseClientDb';
import { useAuth } from '@/providers/AuthProvider';
import { conflictSafeUpdate, isStaleWriteError } from '@/services/conflictSafeUpdate.client';
import { pendingOutboxConflicts } from '@/services/outboxReplay.client';
import { listOutbox, markOutboxConflicted, removeFromOutbox, type OutboxEntry } from '@/services/writeOutbox.client';

/**
 * An edit made offline that the server REFUSED when it was replayed.
 *
 * Without this the queue is a place where text goes to die: the intent is stored,
 * the replay is turned away because the document moved on, and nobody is ever
 * told. Mounted app-wide, because the refusal surfaces on reconnect and the
 * person may be nowhere near the screen they typed it on.
 *
 * "Keep mine" is the ONLY path that overwrites, and only after the person chose
 * it: the replay itself never re-sends a refused intent with a fresh revision.
 */
export function OutboxConflictBanner() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [conflicts, setConflicts] = useState<OutboxEntry[]>([]);
  const [stuck, setStuck] = useState(0);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    if (!user?.uid) {
      setConflicts([]);
      setStuck(0);
      return;
    }
    setConflicts(pendingOutboxConflicts(user.uid));
    // Entries that are neither written nor refused: still waiting for a reachable
    // server. They must be VISIBLE — a queue that quietly holds someone's text
    // while the app looks normal is the silent loss with extra steps.
    setStuck(listOutbox(user.uid).filter((e) => e.status === 'pending').length);
  }, [user?.uid]);

  // The DRAINING lives in `OutboxDrain`, mounted unconditionally by the layout:
  // this banner is hidden on the preaching-plan screen, and while the worker lived
  // here that screen had no worker at all — queued writes just waited, unseen.
  // Here we only re-read the queue whenever it changed.
  useEffect(() => {
    refresh();
    const onChanged = () => refresh();
    window.addEventListener(OUTBOX_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(OUTBOX_CHANGED_EVENT, onChanged);
  }, [refresh]);

  const entry = conflicts[0];

  if (!entry) {
    if (stuck === 0) return null;
    // Nothing was refused, but something is still waiting to be sent.
    return (
      <div>
        <p
          role="status"
          className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
        >
          {t('freshness.queuedPending', { count: stuck })}
        </p>
      </div>
    );
  }

  /** Human-readable preview: the plain strings, for the one-line summary. */
  const previewText = Object.values(entry.patch)
    .filter((value): value is string => typeof value === 'string')
    .join(' · ');

  /**
   * EVERYTHING that was refused, losslessly.
   *
   * The preview above only sees top-level strings, and a group's block text lives
   * inside `templates`/`flow` arrays — so "copy my text" handed back a summary while
   * the actual paragraphs stayed invisible. Someone copying and then discarding lost
   * exactly what they thought they had saved. Structured values are rendered as
   * indented JSON: not pretty, but complete, and nothing is claimed that is not there.
   */
  const recoverableText = Object.entries(entry.patch)
    .filter(([field]) => !field.startsWith('rev.') && field !== 'updatedAt')
    .map(([field, value]) =>
      typeof value === 'string' ? `${field}: ${value}` : `${field}: ${JSON.stringify(value, null, 2)}`
    )
    .join('\n\n');

  /**
   * LOAD THEIRS FIRST, THEN discard mine.
   *
   * "Take theirs" used to only delete the queued intent, so the screen went on showing
   * the value that had just been thrown away — the person had neither version. And the
   * load must be judged: if it fails, discarding would destroy the only copy of the
   * refused text while promising a version that never arrived.
   */
  const takeTheirs = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await queryClient.invalidateQueries();
      removeFromOutbox(entry.id);
    } catch (error) {
      console.error('outbox: could not load the other version', error);
      toast.error(t('common.saveError'));
    } finally {
      setBusy(false);
      refresh();
    }
  };

  /** Discard without loading anything — the document is GONE, so there is nothing to load. */
  const discardMissingTarget = () => {
    removeFromOutbox(entry.id);
    refresh();
  };

  /**
   * THE TARGET IS GONE. Deleted from another device while this edit waited in the
   * queue, so there is no document to write into.
   *
   * "Keep mine" is deliberately absent here: it would call an update against a
   * missing document, fail every single time, and teach the person that the button
   * does nothing. What they actually need is their words — so the text is shown and
   * can be copied, and discarding is an explicit, separate act.
   */
  if (entry.targetMissing) {
    return (
      <div>
        <div
          role="alert"
          className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10"
        >
          <p className="font-medium text-amber-900 dark:text-amber-200">
            {t('freshness.deletedElsewhereTitle')}
          </p>
          <p className="mt-0.5 text-amber-800/80 dark:text-amber-200/70">
            {t('freshness.deletedElsewhereBody')}
          </p>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-white/70 px-3 py-2 text-gray-900 dark:bg-gray-900/40 dark:text-gray-100">
            {recoverableText || t('freshness.conflictPendingLabel')}
          </pre>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(recoverableText)
                  .then(() => toast.success(t('freshness.copiedToast')))
                  .catch(() => toast.error(t('common.saveError')));
              }}
              className="rounded-lg bg-amber-600 px-3 py-1.5 font-medium text-white transition-colors hover:bg-amber-700"
            >
              {t('freshness.copyTextAction')}
            </button>
            <button
              type="button"
              onClick={discardMissingTarget}
              className="rounded-lg border border-amber-300 px-3 py-1.5 font-medium text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-500/40 dark:text-amber-200 dark:hover:bg-amber-500/20"
            >
              {t('freshness.discardAction')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const keepMine = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Deliberate overwrite: state the revision the server held AT REFUSAL.
      await conflictSafeUpdate(
        doc(getClientDb(), entry.collection, entry.docId),
        entry.patch as Parameters<typeof conflictSafeUpdate>[1],
        `${entry.collection}/${entry.docId} not found`,
        { aggregate: entry.aggregate, expectedRevision: entry.actualRevision ?? entry.baseRevision }
      );
      removeFromOutbox(entry.id);
    } catch (error) {
      // Refused AGAIN because the document moved on between the first refusal and
      // this click. Re-aim at what the server holds now, or every further press
      // would resend the same outdated number and the button would never work.
      if (isStaleWriteError(error)) {
        markOutboxConflicted(entry.id, error.actualRevision);
      }
      console.error('outbox: keep-mine failed', error);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  // NO container classes of its own: the layout already provides the page gutter,
  // and adding `mx-auto/px-*` here leaked a page-level container into every screen.
  return (
    <div>
      <SaveConflictBanner
        entityKey="entityRecord"
        pendingText={previewText || t('freshness.conflictPendingLabel')}
        onKeepMine={keepMine}
        onTakeTheirs={takeTheirs}
        busy={busy}
        className="mb-3"
      />
      {/* EVERYTHING that was refused, not just the one-line preview. A group's block
          text lives inside `flow`/`templates` arrays, so the summary above showed a
          title while the paragraphs stayed invisible — the person was choosing between
          "mine" and "theirs" without being able to see what "mine" was. */}
      <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm dark:border-amber-500/30 dark:bg-amber-500/5">
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-gray-900 dark:text-gray-100">
          {recoverableText || t('freshness.conflictPendingLabel')}
        </pre>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(recoverableText)
              .then(() => toast.success(t('freshness.copiedToast')))
              .catch(() => toast.error(t('common.saveError')));
          }}
          className="mt-2 rounded-lg border border-amber-300 px-3 py-1.5 font-medium text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-500/40 dark:text-amber-200 dark:hover:bg-amber-500/20"
        >
          {t('freshness.copyTextAction')}
        </button>
      </div>
    </div>
  );
}
