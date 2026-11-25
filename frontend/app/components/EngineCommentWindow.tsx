'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { paragraphPlaceRefusal, storedCommentLayout } from '@/components/bible/commentParagraphPlacement';
import { CommentKindSwitch, CommentWayBar } from '@/components/CommentDialogFields';
import { legacyCommentEdits } from '@/components/commentDraftBase';
import { CommentPlaceShown, MovePlaceButton, useCommentPlace } from '@/components/CommentPlaceMove';
import MarkdownDisplay from '@/components/MarkdownDisplay';
import { SaveConflictBanner } from '@/components/SaveConflictBanner';
import { DeleteIconButton } from '@/components/ui/DeleteIconButton';
import { DocumentFieldHistory } from '@/components/ui/DocumentFieldHistory';
import FormDialog, { FormActions } from '@/components/ui/FormDialog';
import FormField, { FORM_INPUT_CLASS } from '@/components/ui/FormField';
import { RichMarkdownEditor } from '@/components/ui/RichMarkdownEditor';
import { useBufferedText } from '@/components/ui/useBufferedText';
import { useEditorOwnedText } from '@/components/ui/useEditorOwnedText';
import { UnsavedDraftOffer } from '@/components/UnsavedDraftOffer';
import { DataSyncStatus, FieldComparison } from '@/data-engine/DataSyncStatus';
import { equalValues, firstCommentReference, newCommentEditorSlot, replaceCommentReference, useRecoveryDiscovery } from '@/data-engine/react.client';
import { useConfirm, useDiscardQuestion } from '@/hooks/useConfirm';
import { useDurableDraft } from '@/hooks/useDurableDraft';
import { engineNote, studyNoteCreationValue, useStudyNotesEngine } from '@/hooks/useStudyNotesEngine';
import { sayFailure, type FailureWords } from '@/utils/actionFailureMessage';
import { resolveAppLocale } from '@/utils/appLocale';
import { newClientId } from '@/utils/clientId';
import { COMMENT_DRAFT_AGGREGATE, findCommentDraftCopies, type CommentDraft } from '@/utils/commentDrafts';
import { measureComment } from '@/utils/commentLength';
import { matchesDraftCapture, readDraft } from '@/utils/durableDraft';
import { referenceBibleFor } from '@/utils/scriptureReferenceNumbering';
import { fieldLabel } from '@/utils/storedFieldLabel';
import { isStudyNoteDraft } from '@/utils/studyNoteDraft';
import { isStudyNoteBodyDocument } from '@/utils/studyNoteType';
import { useTranslation } from '@locales/useTranslation';

import { useCommentEditorDocument } from './useCommentEditorDocument';

import type { CommentDialogProps } from './CommentDialog';
import type { RecoveryCheckpoint } from '@/data-engine/controller';
import type { DocumentUpdateOptions } from '@/data-engine/react.client';
import type { DocumentData, FieldValue } from '@/data-engine/types';
import type { ScriptureReference, StudyNote } from '@/models/models';

const ASKING_PHASES = new Set(['conflict', 'remoteChanged', 'refused']);
const NO_LEGACY_DRAFT: CommentDraft = { text: '', reference: null };

function updatedComment(current: DocumentData, confirmed: DocumentData | null, asNote: boolean): DocumentData {
  const next: DocumentData = { ...current, type: asNote ? 'note' : 'comment' };
  if (asNote && typeof current.title === 'string') next.title = current.title.trim();
  if (!asNote && confirmed === null) next.title = '';
  else if (!asNote && current.title !== confirmed?.title) {
    if (confirmed?.title === undefined) delete next.title;
    else next.title = confirmed.title;
  }
  if (asNote && !equalValues(current.paragraph, confirmed?.paragraph)) {
    if (confirmed?.paragraph === undefined) delete next.paragraph;
    else next.paragraph = confirmed.paragraph;
  }
  if (equalValues(confirmed, next)) return next;
  return { ...next, updatedAt: new Date().toISOString(), isDraft: isStudyNoteDraft(next as unknown as StudyNote) };
}

function newCommentValue(owner: string, reference: ScriptureReference | null, paragraph: boolean | undefined): DocumentData {
  return studyNoteCreationValue({ userId: owner, type: 'comment', content: '', title: '', tags: [], paragraph,
    scriptureRefs: reference ? [reference] : [], materialIds: [], relatedSermonIds: [] }, new Date().toISOString());
}

export function EngineCommentWindow({ target, place, context, bible, placeOf, onErased, onClose, onSaved, returnFocusTo,
  openingPlace, away, onChooseVerses, versesRefusal, placeRefusal, paragraphChoice, placePicker, restorePlace }: CommentDialogProps) {
  const { t, language } = useTranslation();
  const locale = resolveAppLocale(language);
  const { uid, notes, commentCollectionReady } = useStudyNotesEngine(true);
  const creating = target.kind === 'new';
  const reference = target.kind === 'new' ? target.reference : null;
  const { id, document, legacyAddress, sourceId, listCopies, restoreCopy, discardCopy, parkLegacyCreation } = useCommentEditorDocument(target, Boolean(placePicker));
  const { confirm, confirmDialog } = useConfirm();
  const { askBeforeDiscard, discardDialog } = useDiscardQuestion();
  const [busy, setBusy] = useState(false);
  const [placeChanged, setPlaceChanged] = useState(false);
  const [placementError, setPlacementError] = useState<FailureWords | null>(null);
  const running = useRef(false);
  const restoringText = useRef<string | null>(null);
  const [writerId] = useState(newClientId);

  const checkpoint = document.state?.checkpoint;
  const ready = Boolean(checkpoint);
  const draft = document.data;
  const current = document.confirmed?.value;
  const rawHome = firstCommentReference(current?.scriptureRefs);
  const rawPlace = firstCommentReference(draft?.scriptureRefs);
  const openedPlace = useRef(rawHome);
  useLayoutEffect(() => { if (!openedPlace.current && rawHome) openedPlace.current = rawHome; }, [rawHome]);
  const standing = useMemo(() => current && engineNote(current, id, locale), [current, id, locale]);
  const shown = useMemo(() => draft && engineNote(draft, id, locale), [draft, id, locale]);
  const home = creating ? reference ?? undefined : standing?.scriptureRefs[0];
  const shownReference = shown?.scriptureRefs[0];
  const relocated = creating
    ? newCommentEditorSlot(shownReference ?? null, false) !== newCommentEditorSlot(reference, false)
    : !equalValues(rawHome, rawPlace);
  const moved = rawPlace && relocated ? shownReference ?? null : null;
  const paragraph = shown?.paragraph ?? (!creating && home ? paragraphChoice?.inferFromReference?.(home) : undefined)
    ?? paragraphChoice?.initial ?? false;
  const canEdit = Boolean(checkpoint && !document.readOnly && (draft?.type === 'comment'
    || (draft?.type === 'note' && (creating || current?.type === 'comment'))
    || (creating && !draft && !document.confirmed?.metadata)));
  const phase = document.status?.phase;
  const choosing = Boolean(phase && ASKING_PHASES.has(phase));
  const pending = checkpoint ? Object.values(checkpoint.pending) : [];
  const dirty = Boolean(checkpoint?.dirty && pending.every(save => save.generation < checkpoint.editGeneration));

  const stage = (update: (live: DocumentData) => DocumentData, options?: DocumentUpdateOptions) =>
    document.update(live => {
      if (live && isStudyNoteBodyDocument(live)) return update(live);
      if (!live && creating && uid && !document.confirmed?.metadata) return update(newCommentValue(uid, reference, paragraphChoice?.initial));
      return live;
    }, options);

  const { text, follow, replace, ownedBy } = useEditorOwnedText(shown?.content ?? '', (value, opening) => {
    void stage(live => ({ ...live, content: value }),
      { action: { kind: 'study-note-field', field: 'content', opening } }).catch(() => undefined);
  });
  useLayoutEffect(() => {
    const observed = shown?.content ?? (creating && ready ? '' : undefined);
    if (observed === undefined) return;
    if (restoringText.current === observed) {
      restoringText.current = null;
      replace(observed);
    } else follow(observed);
  }, [shown?.content, creating, ready, follow, replace]);
  const title = useBufferedText(shown?.title ?? '', (value, opening) =>
    stage(live => ({ ...live, title: value }),
      { action: { kind: 'study-note-field', field: 'title', opening: opening ?? shown?.title ?? '' } }));

  const changePlace = (next: ScriptureReference | null) => {
    // Put Back uses the raw saved reference, including legacy references with no explicit Bible.
    const destination = next ?? (creating ? reference : null);
    const selected = destination ? Object.fromEntries(Object.entries(destination).filter(([, value]) => value !== undefined)) as DocumentData : rawHome;
    if (creating) {
      void stage(live => ({ ...live, scriptureRefs: selected ? [selected] : [] })).catch(() => undefined);
      return;
    }
    if (!selected) return;
    void document.update(live => {
      if (live?.type !== 'comment' || firstCommentReference(live.scriptureRefs)?.id !== selected.id) {
        setPlaceChanged(true);
        return live;
      }
      setPlaceChanged(false);
      const references = replaceCommentReference(live.scriptureRefs, { exists: true, value: selected });
      return references === undefined ? live : { ...live, scriptureRefs: references };
    // Returning an unsent selection to its saved place cancels the draft; only a prior
    // submitted move can make this a new reversal to record.
    }, next || pending.length ? { action: { kind: 'comment-place' } } : undefined).catch(() => undefined);
  };
  const where = useCommentPlace({ standing: home, newPlace: creating ? reference : undefined, choosesOwn: creating && Boolean(placePicker), bible, placeOf,
    context, openingPlace, notes, ownId: id, draftPlace: { moved, change: changePlace, homeChanged: !equalValues(openedPlace.current ?? rawHome, rawHome) } });
  const { isNote, sentences } = measureComment(text);
  const kindOffered = Boolean(paragraphChoice && !isNote);
  const heading = kindOffered && paragraph;
  const chooseKind = (value: boolean) => stage(live => live.type === 'comment' ? { ...live, paragraph: value } : live,
    { action: { kind: 'comment-kind' } });
  const previousPickerReference = useRef(reference);
  const revealRecoveredPlace = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!creating || !placePicker || !checkpoint || reference === previousPickerReference.current) return;
    previousPickerReference.current = reference;
    // The outer picker owns its open state. The selected place belongs to this draft.
    changePlace(reference);
  });
  useEffect(() => {
    if (!creating || !sourceId || !restorePlace || !shownReference || revealRecoveredPlace.current === sourceId) return;
    revealRecoveredPlace.current = sourceId;
    restorePlace(shownReference);
  }, [creating, sourceId, restorePlace, shownReference]);
  const canDiscover = Boolean(canEdit && document.state?.durable && !dirty && phase === 'saved');
  const recovery = useRecoveryDiscovery<RecoveryCheckpoint>({
    identity: document.recoveryIdentity,
    enabled: canDiscover,
    version: String(document.confirmed?.metadata?.revision ?? ''),
    list: listCopies,
    recover: async id => {
      const selected = recovery.choices.find(copy => copy.id === id);
      if (!selected) throw new Error('The selected comment draft changed');
      await restoreCopy(selected);
    },
  });
  const backup = useDurableDraft({
    uid, docId: legacyAddress, aggregate: COMMENT_DRAFT_AGGREGATE, writerId, findCopies: findCommentDraftCopies,
    value: NO_LEGACY_DRAFT, enabled: false, confirmedValue: null,
  });
  const candidate = canDiscover ? recovery.choices[0] : undefined;
  const legacy = canDiscover && !candidate ? backup.recovered : null;
  const waiting = Boolean(candidate || legacy);
  const editable = canEdit && !busy && !waiting && !recovery.loading;

  const run = async (action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try { await action(); }
    catch { toast.error(t('comment.notSaved')); }
    finally { running.current = false; setBusy(false); }
  };

  const restore = () => void run(async () => {
    if (candidate) {
      const content = candidate.record.checkpoint.draft?.content;
      restoringText.current = typeof content === 'string' ? content : null;
      try { await recovery.recover(candidate.id); }
      catch (error) { restoringText.current = null; throw error; }
    } else if (legacy && creating && uid) {
      const selected = backup.recoveries.find(copy => copy.key === backup.recoveredKey);
      if (!selected) return;
      const original = selected.sourceRecord ?? selected;
      if (!matchesDraftCapture(readDraft(selected.key) ?? undefined, original)) {
        backup.settleRecovered();
        return;
      }
      const retire = backup.captureRecoveredDiscard();
      const value = newCommentValue(uid, legacy.reference ?? reference, legacy.paragraph ?? paragraphChoice?.initial);
      const source = await parkLegacyCreation(selected.key, original, { ...value, content: legacy.text, title: legacy.title ?? '' });
      retire();
      if (source) {
        restoringText.current = legacy.text;
        await restoreCopy(source);
      }
    } else if (legacy && standing) {
      const retire = backup.captureRecoveredDiscard();
      const edits = legacyCommentEdits(backup.recoveredBase, legacy, standing, locale);
      if (edits.some(edit => edit.field === 'content')) restoringText.current = legacy.text;
      try { await document.importLegacyStudyNote({ kind: 'comment', edits }); }
      catch (error) { restoringText.current = null; throw error; }
      retire();
    }
  });

  // While a new keystroke is being stored, the phase can be savingLocally even with an unanswered comparison.
  const canSubmit = editable && !placeChanged && !choosing && !checkpoint?.conflicts.length
    && phase !== 'deleted' && phase !== 'localFailure' && (!creating || Boolean((shownReference ?? reference)?.chapter))
    && sentences > 0 && (!isNote || Boolean(title.draft.trim()));
  const save = (reviewed = false) => {
    if (!editable || (!reviewed && !canSubmit) || !sentences || (isNote && !title.draft.trim()) || !checkpoint || (!creating && !current)) return;
    const checked = !isNote ? creating ? (shownReference ?? reference) : moved ?? (shown?.paragraph === true && current?.paragraph !== true ? home : undefined) : null;
    if (checked) {
      const refusal = placeRefusal ? placeRefusal(checked, paragraph) : paragraphPlaceRefusal(
        checked, checked.bible ?? referenceBibleFor(locale), paragraph, id,
        book => commentCollectionReady ? storedCommentLayout(notes, book, checked.bible ?? referenceBibleFor(locale), locale) : null, locale);
      if (refusal) {
        if (placeRefusal) toast.error(sayFailure(refusal, t));
        else setPlacementError(refusal);
        return;
      }
    }
    setPlacementError(null);
    void run(async () => {
      if (reviewed) await document.keepLocal(checkpoint);
      let savedAs: 'note' | 'comment' | undefined;
      await document.commit((live, opening) => {
        const validOpening = creating ? opening?.value === null && opening.metadata === null : opening?.value?.type === 'comment';
        if (!live || !isStudyNoteBodyDocument(live) || !validOpening) {
          throw Object.assign(new Error('The original comment changed before saving'), { code: 'decision-changed' });
        }
        const next = updatedComment(live, opening?.value ?? null, isNote);
        if (!equalValues(next, opening?.value)) savedAs = isNote ? 'note' : 'comment';
        return next;
      });
      if (savedAs === 'note') toast.success(t('comment.becameNote'));
      if (savedAs === 'comment') onSaved?.(id);
      onClose();
    });
  };
  const closeDiscarding = () => {
    if (!checkpoint || !dirty) { onClose(); return; }
    void run(async () => {
      const submitted = pending.reduce<typeof pending[number] | undefined>((latest, save) => !latest || save.generation > latest.generation ? save : latest, undefined);
      if (choosing && !submitted) await document.acceptRemote(checkpoint);
      const latest = document.remote ?? document.confirmed;
      await document.edit(submitted ? submitted.value : latest?.value ?? null);
      onClose();
    });
  };
  const takeStored = () => void run(async () => {
    if (!checkpoint) return;
    await document.acceptRemote(checkpoint);
    if (document.remote?.value && document.remote.value.type !== 'comment') {
      toast.success(t('comment.noteElsewhere'));
      onClose();
    } else where.tookTheirs();
  });
  const requestClose = () => {
    void askBeforeDiscard(dirty, closeDiscarding);
  };
  const erase = () => void run(async () => {
    if (!(await confirm({ title: { key: 'comment.eraseTitle' }, confirmText: { key: 'comment.erase' } }))) return;
    await document.remove();
    (onErased ?? onClose)();
  });

  const fieldText = ({ exists, value }: FieldValue, field: string) => {
    if (!exists || value === '') return t('dataSync.emptyField');
    if (field === 'paragraph') return t(value ? 'comment.kind.paragraph' : 'comment.kind.comment');
    if (field === 'scriptureRefs' && value && typeof value === 'object' && 'book' in value) return where.labelOf(value as unknown as ScriptureReference);
    return typeof value === 'string' ? value : JSON.stringify(value);
  };
  const displayedPlace = where.shown(place);
  const snapshot = document.confirmed?.metadata;
  const comparedFields = checkpoint?.conflicts ?? [];
  const comparesMetadata = comparedFields.some(({ path }) => path[0] !== 'content');
  const oldCopy = candidate?.record.checkpoint.draft;
  const previewContent = candidate && typeof oldCopy?.content === 'string' ? oldCopy.content : legacy?.text ?? '';

  return (
    <FormDialog away={away} title={displayedPlace ? t(heading ? 'comment.titleParagraph' : 'comment.title', { place: displayedPlace }) : t('comment.titleNew')}
      description={t(heading ? 'comment.paragraphDescription' : 'comment.description')} onClose={closeDiscarding}
      titleAction={where.movable ? <div ref={where.buttonRef}>
        <MovePlaceButton open={where.open} disabled={!editable} onToggle={where.toggle} />
      </div> : null}
      cornerAction={!creating ? <DeleteIconButton label={t('comment.erase')} onClick={erase}
        disabled={!editable || !document.status?.canRemove} /> : null}
      returnFocusTo={returnFocusTo} unsaved={dirty} closeDisabled={busy} onSubmit={event => { event.preventDefault(); save(); }}
      footer={<FormActions onCancel={closeDiscarding} cancelLabel={t('common.cancel')} submitLabel={isNote ? t('comment.toNote') : t('common.done')}
        saving={busy} submitDisabled={!canSubmit} tone={isNote ? 'emerald' : 'blue'} unsaved={dirty} />}
    >
      <div className="space-y-4">
        {kindOffered ? <CommentKindSwitch paragraph={paragraph} onChange={value => { void chooseKind(value).catch(() => undefined); }} disabled={!editable} /> : null}
        {kindOffered && !creating && uid && snapshot ? <DocumentFieldHistory key={JSON.stringify([uid, id, snapshot.generation])}
          session={{ owner: uid, noteId: id, generation: snapshot.generation, field: 'comment-kind', restore: chooseKind }}
          current={paragraph} disabled={!editable} /> : null}
        {editable ? placePicker?.({ requestClose }) : null}
        {placeChanged ? <p role="alert">{t('comment.placeChanged')}</p> : null}
        {placementError ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-800 dark:bg-red-950 dark:text-red-200">{sayFailure(placementError, t)}</p> : null}
        {choosing && document.status?.canAcceptRemote
          ? document.error && <p role="alert">{document.error}</p>
          : <DataSyncStatus subject={document.recoveryIdentity} status={document.status} error={document.error}
              errorWords={document.errorWords} onRetry={document.retry} recoveryError={recovery.error} />}
        {choosing && document.status?.canAcceptRemote ? <>
          {comparedFields.map(({ path, mine, theirs }) => <FieldComparison key={JSON.stringify(path)}
            comparison={{ valueKind: 'field', title: fieldLabel(t, path[0]), mine: fieldText(mine, path[0]), stored: fieldText(theirs, path[0]) }} />)}
          <SaveConflictBanner entityKey="entityComment" onKeepMine={() => save(true)} keepMineDisabled={!document.status.canKeepLocal}
            onTakeTheirs={takeStored} busy={busy} {...(comparesMetadata && {
              keepMineLabel: t('dataSync.useLocalVersion'), takeTheirsLabel: t('dataSync.useStoredVersion'),
              description: t(comparedFields.length > 1 ? 'dataSync.noteFieldsChanged' : 'dataSync.fieldVersionChanged'),
            })} />
        </> : null}
        {waiting ? <UnsavedDraftOffer preview={<MarkdownDisplay pencil content={previewContent} className="text-sm text-gray-700 dark:text-gray-200" />}
          onRestore={restore} onDiscard={() => candidate
            ? void run(() => recovery.discard(() => discardCopy(candidate)))
            : backup.discardRecovered()} /> : null}
        <CommentPlaceShown where={where} place={place} busy={busy} deciding={!editable}
          onChooseVerses={onChooseVerses ? (here, moveTo) => onChooseVerses(here, moveTo, kindOffered ? paragraph : undefined) : undefined}
          versesRefusal={versesRefusal} />
        {shown || (creating && checkpoint) ? <RichMarkdownEditor ownedBy={ownedBy} placeholder={t('comment.placeholder')} minHeight="11rem" autoFocus editable={editable} /> : null}
        <CommentWayBar text={text} paragraph={heading} />
        {isNote ? <div className="space-y-3">
          <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">{t('comment.becomesNote')}</p>
          <FormField label={t('comment.noteTitle')} required>
            <input value={title.draft} onChange={event => { void title.change(event.target.value); }} placeholder={t('comment.noteTitlePlaceholder')}
              className={FORM_INPUT_CLASS} disabled={!editable} />
          </FormField>
        </div> : null}
      </div>
      {confirmDialog}
      {discardDialog}
    </FormDialog>
  );
}
