'use client';

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';

import { useClipboard } from '@/hooks/useClipboard';
import { isOutlineCollisionError } from '@/services/sermons.client';
import { newClientId } from '@/utils/clientId';
import { serializeContent } from '@/utils/contentFingerprint';
import { clearDraftIfMatches, draftKey, findDraftCopies, nextDraftEditTime, readDraft, saveDraft, type DurableDraft } from '@/utils/durableDraft';
import { changedCapitalizedTitle, normalizeCapitalizedTitle } from '@/utils/textNormalization';
import { useTranslation } from '@locales/useTranslation';

import type { OutlineTitleOpening } from '@/utils/sermonNoteText';

type DraftValue = { target: OutlineTitleOpening['target']; text: string };
type DraftCopy = { key: string; value: DraftValue; stored: DurableDraft<DraftValue> | null };

type DraftActions = {
  keyFor: (openingId: string) => string;
  remember: (key: string, value: DraftValue) => DraftCopy;
  discard: (draft: DraftCopy) => void;
  attach: (key: string, attached: boolean) => void;
};

const AGGREGATE = 'outline-title';
const HEADING = 'structure.unsubmittedTitle.heading';
const TitleDraftActions = createContext<DraftActions | null>(null);
const DetachedTitles = createContext<readonly DraftCopy[]>([]);

type DraftScopeProps = PropsWithChildren<{ owner: string | null; resource: string }>;

export function OutlineTitleDraftScope(props: DraftScopeProps) {
  return <DraftScope key={JSON.stringify([props.owner, props.resource])} {...props} />;
}

function DraftScope({ owner, resource, children }: DraftScopeProps) {
  const copies = useRef(new Map<string, DraftCopy>());
  const [detached, setDetached] = useState<readonly DraftCopy[]>([]);
  const attached = useRef(new Set<string>());
  const publish = useCallback(() => {
    const visible = [...copies.current.values()].filter(copy => !attached.current.has(copy.key));
    setDetached(previous => previous.length === visible.length && previous.every((copy, index) => copy === visible[index])
      ? previous : visible);
  }, []);
  useEffect(() => {
    if (!owner) return;
    for (const { key, value, sourceRecord } of findDraftCopies<DraftValue>(owner, resource, AGGREGATE)) {
      if (typeof value?.text !== 'string' || !value.text || copies.current.has(key)) continue;
      copies.current.set(key, { key, value, stored: sourceRecord as DurableDraft<DraftValue> });
    }
    publish();
  }, [owner, resource, publish]);
  const actions = useMemo<DraftActions>(() => ({
    keyFor: openingId => owner ? draftKey(owner, resource, AGGREGATE, openingId) : openingId,
    remember: (key, value) => {
      const previous = copies.current.get(key)?.stored ?? null;
      const editedAt = nextDraftEditTime(previous?.editedAt);
      const stored = owner && saveDraft(key, value, undefined, false, editedAt) ? readDraft<DraftValue>(key) : previous;
      const copy = { key, value, stored };
      copies.current.set(key, copy);
      publish();
      return copy;
    },
    discard: draft => {
      if (copies.current.get(draft.key) !== draft) return;
      if (owner) {
        const stored = readDraft<DraftValue>(draft.key);
        if (stored && serializeContent(stored) !== serializeContent(draft.stored)) {
          // A confirmed dismissal still names the physical copy the user saw.
          copies.current.set(draft.key, { key: draft.key, value: stored.value, stored });
          publish();
          return;
        }
        clearDraftIfMatches(draft.key, draft.value, stored ?? undefined);
        if (stored && serializeContent(stored.value) !== serializeContent(draft.value)) {
          // The latest backup was refused. Discard the older physical copy too.
          clearDraftIfMatches(draft.key, stored.value, stored);
        }
      }
      copies.current.delete(draft.key);
      publish();
    },
    attach: (key, active) => {
      if (active) attached.current.add(key);
      else attached.current.delete(key);
      publish();
    },
  }), [owner, resource, publish]);
  return <TitleDraftActions.Provider value={actions}>
    <DetachedTitles.Provider value={detached}>{children}</DetachedTitles.Provider>
  </TitleDraftActions.Provider>;
}

function DetachedTitle({ copy, discard }: { copy: DraftCopy; discard: () => void }) {
  const { t } = useTranslation();
  const { copyToClipboard, isCopied } = useClipboard();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  return <div className="min-w-0 space-y-2">
    <textarea aria-label={t(HEADING)} readOnly rows={2} value={copy.value.text}
      className="w-full rounded border border-amber-300 bg-white px-2 py-1 text-sm dark:border-amber-700 dark:bg-gray-900" />
    <div className="flex flex-wrap gap-2 text-sm">
      <button type="button" className="rounded border border-current px-2 py-1" onClick={() => { void copyToClipboard(copy.value.text); }}>
        {isCopied ? t('freshness.copiedToast') : t('freshness.copyTextAction')}
      </button>
      {confirmDiscard ? <>
        <button type="button" className="rounded border border-current px-2 py-1" onClick={discard}>{t('unsavedDraft.discard')}</button>
        <button type="button" className="rounded px-2 py-1" onClick={() => setConfirmDiscard(false)}>{t('common.cancel')}</button>
      </> : <button type="button" className="rounded px-2 py-1" onClick={() => setConfirmDiscard(true)}>
        {t('structure.unsubmittedTitle.discard')}
      </button>}
    </div>
  </div>;
}

export function OutlineTitleDraftNotices() {
  const copies = useContext(DetachedTitles);
  const actions = useContext(TitleDraftActions);
  const { t } = useTranslation();
  if (!copies.length || !actions) return null;
  return <section aria-label={t(HEADING)}
    className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
    <p className="text-sm font-semibold">{t(HEADING)}</p>
    <p className="text-sm">{t('structure.unsubmittedTitle.body')}</p>
    {copies.map(copy => <DetachedTitle key={JSON.stringify([copy.key, copy.stored?.editedAt])} copy={copy} discard={() => actions.discard(copy)} />)}
  </section>;
}

/** The field stays private until Enter. If it is removed, the document still owns its copy. */
export function useOutlineTitleDraft(visibleTargetId: string | null) {
  const actions = useContext(TitleDraftActions);
  const field = useRef<{ key: string; opening: OutlineTitleOpening; displayed: string; copy?: DraftCopy } | null>(null);
  useLayoutEffect(() => {
    const open = field.current;
    if (!actions || !open || open.opening.target.id !== visibleTargetId) return;
    actions.attach(open.key, true);
    return () => actions.attach(open.key, false);
  }, [actions, visibleTargetId]);
  return {
    open: (opening: OutlineTitleOpening, displayed: string) => {
      if (actions) field.current = { key: actions.keyFor(newClientId()), opening, displayed };
    },
    change: (text: string) => {
      const open = field.current;
      if (!actions || !open) return;
      if (!changedCapitalizedTitle(text, open.displayed)) {
        if (open.copy) actions.discard(open.copy);
        open.copy = undefined;
        return;
      }
      open.copy = actions.remember(open.key, { target: open.opening.target, text });
    },
    cancel: () => {
      if (field.current?.copy) actions?.discard(field.current.copy);
    },
    handoff: (writing: Promise<unknown> | void) => {
      const copy = field.current?.copy;
      if (!actions || !copy || !writing) return;
      void writing.then(() => actions.discard(copy), error => {
        const retained = isOutlineCollisionError(error) ? error.retainedTitle : undefined;
        if (retained?.target.id === copy.value.target.id && retained.target.kind === copy.value.target.kind
          && retained.text === normalizeCapitalizedTitle(copy.value.text)) actions.discard(copy);
      });
    },
  };
}
