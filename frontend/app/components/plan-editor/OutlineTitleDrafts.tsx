'use client';

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';

import { useStructureWriter } from '@/components/sermon/structureWriter';
import { discardLegacyOutlineTitle, mergeOutlineTitleDrafts, outlineTitleDraftKey, readLegacyOutlineTitleDrafts, useOutlineTitleDraftSession,
  type OutlineTitleDraftCopy as DraftCopy } from '@/data-engine/react.client';
import { useClipboard } from '@/hooks/useClipboard';
import { isOutlineCollisionError } from '@/services/sermons.client';
import { newClientId } from '@/utils/clientId';
import { readOutlineTitleText } from '@/utils/sermonNoteText';
import { changedCapitalizedTitle, normalizeCapitalizedTitle } from '@/utils/textNormalization';
import { useTranslation } from '@locales/useTranslation';

import type { SermonOutline } from '@/models/models';
import type { OutlineNoteTarget, OutlineTitleOpening } from '@/utils/sermonNoteText';


type DraftActions = {
  keyFor: (openingId: string) => string;
  remember: (openingId: string, value: DraftCopy['value'], prior?: DraftCopy) => DraftCopy;
  discard: (draft: DraftCopy) => Promise<void> | void;
  submit: (draft: DraftCopy, pending: boolean) => void;
  attach: (key: string, attached: boolean) => void;
};

const HEADING = 'structure.unsubmittedTitle.heading';
const TitleDraftActions = createContext<DraftActions | null>(null);
const DetachedTitles = createContext<readonly DraftCopy[]>([]);

type DraftScopeProps = PropsWithChildren<{ owner: string | null; resource: string; discover?: boolean; onPresenceChange?: (present: boolean) => void }>;

export { listLegacyOutlineTitleDraftIds as listOutlineTitleDraftIds, outlineTitleDraftResource } from '@/data-engine/react.client';

export function OutlineTitleDraftScope(props: DraftScopeProps) {
  return <DraftScope key={JSON.stringify([props.owner, props.resource])} {...props} />;
}

function DraftScope({ owner, resource, discover = true, onPresenceChange, children }: DraftScopeProps) {
  const session = useOutlineTitleDraftSession(owner, resource);
  const copies = useRef(new Map<string, DraftCopy>());
  const discarded = useRef(new Map<string, number>());
  const [detached, setDetached] = useState<readonly DraftCopy[]>([]);
  const attached = useRef(new Set<string>());
  const submitting = useRef(new Set<DraftCopy>());
  const notifyPresence = useRef(onPresenceChange);
  notifyPresence.current = onPresenceChange;
  const hadCopies = useRef(false);
  const publish = useCallback(() => {
    const hasCopies = copies.current.size > 0;
    if (hadCopies.current !== hasCopies) {
      hadCopies.current = hasCopies;
      notifyPresence.current?.(hasCopies);
    }
    const visible = [...copies.current.values()].filter(copy => !attached.current.has(copy.key) && !submitting.current.has(copy));
    setDetached(previous => previous.length === visible.length && previous.every((copy, index) => copy === visible[index])
      ? previous : visible);
  }, []);
  const forget = useCallback((copy: DraftCopy) => {
    discarded.current.set(copy.key, Math.max(copy.editedAt, discarded.current.get(copy.key) ?? -Infinity));
    const visible = copies.current.get(copy.key);
    if (!visible || visible.editedAt > copy.editedAt) return;
    copies.current.delete(copy.key);
    publish();
  }, [publish]);
  useEffect(() => session?.subscribeRetirements(forget), [session, forget]);
  useEffect(() => {
    if (!owner || !discover) return;
    let active = true;
    const include = (stored: readonly DraftCopy[]) => {
      if (!active) return;
      const visible = stored.filter(copy => copy.editedAt > (discarded.current.get(copy.key) ?? -Infinity));
      const merged = mergeOutlineTitleDrafts([...visible, ...copies.current.values()]);
      copies.current = new Map(merged.map(copy => [copy.key, copy]));
      publish();
    };
    include(session ? session.readLocal() : readLegacyOutlineTitleDrafts(owner, resource));
    void session?.readStored().then(include, () => undefined);
    return () => { active = false; };
  }, [owner, resource, session, publish, discover]);
  const actions = useMemo<DraftActions>(() => ({
    keyFor: openingId => owner ? outlineTitleDraftKey(owner, resource, openingId) : openingId,
    remember: (openingId, value, prior) => {
      const copy = session?.remember(openingId, value, prior) ?? {
        key: owner ? outlineTitleDraftKey(owner, resource, openingId) : openingId, value, editedAt: Date.now(),
      };
      copies.current.set(copy.key, copy);
      publish();
      return copy;
    },
    discard: draft => {
      if (copies.current.get(draft.key) !== draft) return;
      const finish = (remaining?: DraftCopy) => {
        if (copies.current.get(draft.key) !== draft) return;
        if (!remaining) { forget(draft); return; }
        copies.current.set(draft.key, remaining);
        publish();
      };
      if (session) return session.discard(draft).then(finish, () => undefined);
      finish(discardLegacyOutlineTitle(draft));
    },
    submit: (draft, pending) => {
      if (pending) submitting.current.add(draft);
      else submitting.current.delete(draft);
      publish();
    },
    attach: (key, active) => {
      if (active) attached.current.add(key);
      else attached.current.delete(key);
      publish();
    },
  }), [owner, resource, publish, session, forget]);
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

export function OutlineTitleDraftNotices({ shown }: { shown?: SermonOutline } = {}) {
  const detached = useContext(DetachedTitles);
  const copies = shown ? detached.filter(copy =>
    readOutlineTitleText(shown, copy.value.target) !== normalizeCapitalizedTitle(copy.value.text)) : detached;
  const actions = useContext(TitleDraftActions);
  const { t } = useTranslation();
  if (!copies.length || !actions) return null;
  return <section aria-label={t(HEADING)}
    className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
    <p className="text-sm font-semibold">{t(HEADING)}</p>
    <p className="text-sm">{t('structure.unsubmittedTitle.body')}</p>
    {copies.map(copy => <DetachedTitle key={JSON.stringify([copy.key, copy.editedAt])} copy={copy} discard={() => actions.discard(copy)} />)}
  </section>;
}

/** The field stays private until Enter. If it is removed, the document still owns its copy. */
export function useOutlineTitleDraft(visibleTargetId: string | null) {
  const actions = useContext(TitleDraftActions);
  const writer = useStructureWriter();
  const observed = useRef<OutlineTitleOpening | undefined>(undefined);
  const field = useRef<{ key: string; openingId: string; opening: OutlineTitleOpening; displayed: string; copy?: DraftCopy } | null>(null);
  useLayoutEffect(() => {
    const open = field.current;
    if (!actions || !open || open.opening.target.id !== visibleTargetId) return;
    actions.attach(open.key, true);
    return () => actions.attach(open.key, false);
  }, [actions, visibleTargetId]);
  const openField = (opening: OutlineTitleOpening, displayed: string, openingId: string) => {
    if (actions) field.current = { openingId, key: actions.keyFor(openingId), opening, displayed };
  };
  return {
    open: (opening: OutlineTitleOpening, displayed: string) => {
      const version = writer.outlineTitleVersion?.(opening);
      observed.current = version ? { ...opening, version } : opening;
      openField(opening, displayed, newClientId());
    },
    openNew: (target: OutlineNoteTarget) => openField({ target, text: '' }, '', target.id),
    opening: () => observed.current,
    change: (text: string) => {
      const open = field.current;
      if (!actions || !open) return;
      if (!changedCapitalizedTitle(text, open.displayed)) {
        if (open.copy) actions.discard(open.copy);
        open.copy = undefined;
        return;
      }
      open.copy = actions.remember(open.openingId, { target: open.opening.target, text }, open.copy);
    },
    cancel: () => {
      if (field.current?.copy) actions?.discard(field.current.copy);
    },
    handoff: <T,>(writing: Promise<T> | void, accepted?: (value: T) => boolean) => {
      const copy = field.current?.copy;
      if (!actions || !copy || !writing) return;
      actions.submit(copy, true);
      void writing.then(value => {
        if (!accepted || accepted(value)) return actions.discard(copy);
      }, error => {
        const retained = isOutlineCollisionError(error) ? error.retainedTitle : undefined;
        if (retained?.target.id === copy.value.target.id && retained.target.kind === copy.value.target.kind
          && retained.text === normalizeCapitalizedTitle(copy.value.text)) return actions.discard(copy);
      }).finally(() => actions.submit(copy, false));
    },
  };
}


export type OutlineCreation = Promise<SermonOutline | null | void> | void;

/** Reserve the new node's identity on opening. Existing copies are retired by proof of creation. */
export function useNewOutlineTitleDraft(kind: OutlineNoteTarget['kind'], visible: boolean) {
  const openingId = useRef<string | undefined>(undefined);
  const draft = useOutlineTitleDraft(visible ? openingId.current ?? null : null);
  return {
    id: () => openingId.current,
    open: () => {
      const id = newClientId();
      openingId.current = id;
      draft.openNew({ kind, id });
    },
    change: draft.change,
    cancel: draft.cancel,
    handoff: (writing: OutlineCreation, text: string) => {
      const id = openingId.current;
      if (!id || !writing) return;
      draft.handoff(writing, saved => readOutlineTitleText(saved ?? null, { kind, id }) === text);
    },
  };
}
