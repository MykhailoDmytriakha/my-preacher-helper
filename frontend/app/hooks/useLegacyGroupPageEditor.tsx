'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { DataFreshnessBanner } from '@/components/DataFreshnessBanner';
import { SaveConflictBanner } from '@/components/SaveConflictBanner';
import { useAutoSave } from '@/hooks/useAutoSave';
import { useDocumentFreshness } from '@/hooks/useDocumentFreshness';
import { useFreshnessUid } from '@/hooks/useFreshnessUid';
import { useGroupDetail } from '@/hooks/useGroupDetail';
import { changedFields } from '@/utils/changedFields';
import { contentFingerprint } from '@/utils/contentFingerprint';
import { normalizeFlow } from '@/utils/groupFlow';

import type { GroupPageEditor } from './groupPageEditor';
import type { Group, GroupBlockTemplate, GroupFlowItem } from '@/models/models';

/**
 * Anything typed here that the server has not seen yet.
 *
 * Kept outside the component on purpose: it is a pure comparison, and the page
 * function is already at the complexity ceiling.
 */
function hasUnsavedGroupEdits(
  baseline: Parameters<typeof changedFields>[0] | null,
  current: Parameters<typeof changedFields>[1]
): boolean {
  if (!baseline) return false;
  return Object.keys(changedFields(baseline, current)).length > 0;
}

export function useLegacyGroupPageEditor(groupId: string): GroupPageEditor {
  const { t } = useTranslation();
  const {
    group,
    loading,
    updateGroupDetail,
    addMeetingDate,
    updateMeetingDate,
    removeMeetingDate,
    deleteGroupDetail,
    pendingWrites,
    saveConflict,
    resolvingConflict,
    keepMineOnConflict,
    takeTheirsOnConflict,
    adoptRemoteNonce,
    refreshGroupDetail,
  } = useGroupDetail(groupId);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'draft' | 'active' | 'completed'>('draft');
  const [templates, setTemplates] = useState<GroupBlockTemplate[]>([]);
  const [flow, setFlow] = useState<GroupFlowItem[]>([]);
  const updateGroupDetailRef = useRef(updateGroupDetail);
  // Refs so the debounced save always reads the latest state without re-triggering
  const titleRef = useRef(title);
  const descriptionRef = useRef(description);
  const statusRef = useRef(status);
  const templatesRef = useRef(templates);
  const flowRef = useRef(flow);
  titleRef.current = title;
  descriptionRef.current = description;
  statusRef.current = status;
  templatesRef.current = templates;
  flowRef.current = flow;

  const [meetingDate, setMeetingDate] = useState('');
  const [meetingLocation, setMeetingLocation] = useState('');
  const [meetingAudience, setMeetingAudience] = useState('');

  const meetingDateRef = useRef(meetingDate);
  const meetingLocationRef = useRef(meetingLocation);
  const meetingAudienceRef = useRef(meetingAudience);
  const addMeetingDateRef = useRef(addMeetingDate);
  const updateMeetingDateRef = useRef(updateMeetingDate);
  const removeMeetingDateRef = useRef(removeMeetingDate);
  meetingDateRef.current = meetingDate;
  meetingLocationRef.current = meetingLocation;
  meetingAudienceRef.current = meetingAudience;
  addMeetingDateRef.current = addMeetingDate;
  updateMeetingDateRef.current = updateMeetingDate;
  removeMeetingDateRef.current = removeMeetingDate;

  useEffect(() => {
    updateGroupDetailRef.current = updateGroupDetail;
  }, [updateGroupDetail]);

  const initializedGroupIdRef = useRef<string | null>(null);
  /** Which "take theirs" this form has already adopted. */
  const adoptedNonceRef = useRef(0);

  useEffect(() => {
    if (!group) return;
    // Re-initialise ALSO when the person chose the other device's version: the
    // one-per-id guard used to refuse it, so the inputs kept the old local text and
    // the promised version never actually appeared on screen.
    if (initializedGroupIdRef.current === group.id && adoptedNonceRef.current === adoptRemoteNonce) {
      return;
    }

    setTitle(group.title);
    setDescription(group.description || '');
    setStatus(group.status);
    setTemplates(group.templates || []);
    setFlow(normalizeFlow(group.flow || []));
    const firstMeeting = group.meetingDates?.[0];
    setMeetingDate(firstMeeting?.date || '');
    setMeetingLocation(firstMeeting?.location || '');
    setMeetingAudience(firstMeeting?.audience || '');

    initializedGroupIdRef.current = group.id;
    adoptedNonceRef.current = adoptRemoteNonce;
    // The diff baseline moves with the text, or every later autosave would re-send
    // what was just deliberately discarded.
    baselineRef.current = {
      title: group.title,
      description: group.description || undefined,
      status: group.status,
      templates: group.templates || [],
      flow: normalizeFlow(group.flow || []),
    };
  }, [group, adoptRemoteNonce]);

  // Keep a ref to the server-side meeting date id so we know whether to add/update/remove
  const existingMeetingIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    existingMeetingIdRef.current = group?.meetingDates?.[0]?.id;
  }, [group]);

  /**
   * What this page last knew to be the truth: the group as loaded, then whatever a
   * save sent. This — NOT the live cache — is the baseline for "did the user change
   * this field?".
   *
   * Diffing against the cache is the intuitive choice and it destroys data. Two
   * tabs: A renames the group, B (opened earlier, still showing the old name)
   * refetches on focus, so B's CACHE holds A's new name while B's INPUT holds the
   * old one. Against the cache, B's untouched title reads as a deliberate rename
   * back and overwrites A. Reproduced live on the note editor, which had the same
   * mistake. A field the user genuinely changed stays different from this baseline
   * until a save carries it, so a failed write still gets re-sent.
   */
  const baselineRef = useRef<{
    title: string;
    description: string | undefined;
    status: Group['status'];
    templates: Group['templates'];
    flow: Group['flow'];
  } | null>(null);
  // Keyed by document: navigating between groups re-renders this page WITHOUT
  // unmounting, so an unkeyed baseline would keep describing the group we left and
  // silently mark real edits as unchanged.
  const baselineGroupIdRef = useRef<string | null>(null);
  if (group && baselineGroupIdRef.current !== group.id) {
    baselineGroupIdRef.current = group.id;
    baselineRef.current = {
      title: group.title,
      description: group.description || undefined,
      status: group.status,
      templates: group.templates || [],
      flow: normalizeFlow(group.flow || []),
    };
  }

  // Does the server hold a newer version of THIS group? Shared layer with the
  // note/sermon/series pages: observe only, never swap what is on screen.
  // Fingerprints, not counts — editing a block's text or reordering the flow
  // keeps both lengths identical, and the stale screen used to look fresh.
  type GroupWatched = {
    title: string;
    description: string;
    status: string;
    templates: string;
    flow: string;
    meetingDates: string;
  };
  const knownGroup = useMemo<GroupWatched | null>(
    () =>
      group
        ? {
            title: group.title || '',
            description: group.description || '',
            status: group.status || '',
            templates: contentFingerprint(group.templates ?? []),
            flow: contentFingerprint(group.flow ?? []),
            meetingDates: contentFingerprint(group.meetingDates ?? []),
          }
        : null,
    [group]
  );
  const freshnessUid = useFreshnessUid(group?.userId);
  const groupFreshness = useDocumentFreshness<GroupWatched>({
    collection: 'groups',
    docId: group?.id ?? null,
    // The CURRENT signed-in owner, not the owner stored on the cached document.
    // A listener keyed by the document's own userId survives a logout: the cached
    // entity keeps the old owner, the prop never changes, so the effect never
    // cleans up. Requiring the two to match also refuses to listen to a foreign
    // document left in the cache.
    uid: freshnessUid,
    enabled: Boolean(group),
    known: knownGroup,
    select: (data) => ({
      title: (data.title as string) || '',
      description: (data.description as string) || '',
      status: (data.status as string) || '',
      templates: contentFingerprint(data.templates ?? []),
      flow: contentFingerprint(data.flow ?? []),
      meetingDates: contentFingerprint(data.meetingDates ?? []),
    }),
  });
  const [groupFreshnessDismissed, setGroupFreshnessDismissed] = useState(false);
  const [isRefreshingGroup, setIsRefreshingGroup] = useState(false);
  useEffect(() => {
    if (groupFreshness.state === 'stale' || groupFreshness.state === 'unknown') setGroupFreshnessDismissed(false);
  }, [groupFreshness.remote, groupFreshness.state]);

  const performSave = useCallback(
    async () => {
      // Send ONLY what actually changed. Sending every field means a stale tab's
      // title edit overwrites newer templates/flow text written from another
      // device — the whole document is replaced from one editor's snapshot.
      // Let React commit any state change that triggered this save before the
      // refs below are read. Autosave can start while the originating event is
      // still on the stack, so the refs — assigned during render — would still
      // hold pre-change values. HEAD got this for free because it ALWAYS awaited
      // the group write first; now that an unchanged group skips that write, the
      // yield has to be explicit rather than an accident of statement order.
      await Promise.resolve();

      const base = baselineRef.current;
      const nextTitle = titleRef.current.trim();
      const nextDescription = descriptionRef.current.trim() || undefined;
      const nextStatus = statusRef.current;
      const nextTemplates = templatesRef.current;
      const nextFlow = normalizeFlow(flowRef.current);

      const changed = changedFields(base, {
        title: nextTitle,
        description: nextDescription,
        status: nextStatus,
        templates: nextTemplates,
        flow: nextFlow,
      });

      if (Object.keys(changed).length > 0) {
        // ⚠️ NO CONTENT BASELINE HERE — REVERTED 2026-07-26, deliberately.
        //
        // Passing the open-time values looked right and made this screen WORSE THAN
        // BEFORE: the baseline is never advanced (that is what keeps a REFUSED field
        // being re-sent until it lands), so after the first save commits, the second
        // legitimate edit compares its text against values the server no longer has
        // and is refused — against the person's own save, minutes earlier. Content
        // has the final word, so the counter could not save it either.
        //
        // Two invariants of my own collided; the law is to revert, not to pile on a
        // third. The counter still guards this write. What is given up: an old client
        // that changes group text WITHOUT advancing the counter is not caught here.
        // Closing that needs the confirmed-save baseline advance described in
        // BUGS.md, and that is part of the owner's architecture decision.
        await updateGroupDetailRef.current(changed);
        // ⚠️ The baseline is deliberately NOT advanced here. `updateGroupDetail` is
        // fire-and-forget (`useGroupDetail.ts:105`) — it returns before the backend
        // answers, so "sent" is not "stored". Advancing here made a REJECTED write
        // vanish: the field matched the baseline again, dropped out of every later
        // diff, and was never re-sent — strictly worse than HEAD, which resent all
        // content fields on every autosave. Leaving the baseline at the value this
        // page opened with means everything the user changed keeps being sent until
        // it lands. Re-sending the user's own current value is idempotent; losing it
        // is not.
      }

      // Sync single meeting date
      const date = meetingDateRef.current;
      const location = meetingLocationRef.current.trim() || undefined;
      const audience = meetingAudienceRef.current.trim() || undefined;
      const existingId = existingMeetingIdRef.current;

      if (date && existingId) {
        await updateMeetingDateRef.current(existingId, { date, location, audience });
      } else if (date && !existingId) {
        await addMeetingDateRef.current({ date, location, audience });
      } else if (!date && existingId) {
        await removeMeetingDateRef.current(existingId);
      }
    },
    []
  );

  const { debouncedSave, status: autoSaveStatus } = useAutoSave(performSave, {
    delay: 500,
    onError: () => {
      toast.error(
        t('workspaces.groups.errors.updateFailed', {
          defaultValue: 'Failed to update group',
        })
      );
    },
  });

  /**
   * What the indicator is allowed to claim.
   *
   * The group write is fire-and-forget, so `autoSaveStatus` flips to "saved" the
   * moment the request is SENT — before the transaction could refuse it, and even
   * while offline. While a write is still in flight the screen says "saving",
   * which is the truth.
   */
  const saveStatus = pendingWrites > 0 ? 'saving' : autoSaveStatus;

  const groupHasUnsavedChanges = hasUnsavedGroupEdits(baselineRef.current, {
    title: titleRef.current.trim(),
    description: descriptionRef.current.trim() || undefined,
    status: statusRef.current,
    templates: templatesRef.current,
    flow: normalizeFlow(flowRef.current),
  });

  const handleRefreshGroup = async () => {
    if (isRefreshingGroup) return;
    setIsRefreshingGroup(true);
    try {
      await refreshGroupDetail();
      toast.success(t('freshness.refreshedToast'));
    } catch {
      toast.error(t('freshness.refreshFailedToast'));
    } finally {
      setIsRefreshingGroup(false);
    }
  };

  return { group, loading, title, setTitle, description, setDescription, status, setStatus,
    templates, setTemplates, flow, setFlow, meetingDate, setMeetingDate, meetingLocation, setMeetingLocation,
    meetingAudience, setMeetingAudience, debouncedSave, saveStatus, deleteGroupDetail,
    meetingFieldsEnabled: true, feedback: <>      {saveConflict && (
        <SaveConflictBanner
          entityKey="entityRecord"
          onKeepMine={keepMineOnConflict}
          onTakeTheirs={takeTheirsOnConflict}
          busy={resolvingConflict}
        />
      )}
      {/* This GROUP changed elsewhere — distinct from the app-update toast. While
          the editor holds unsaved changes the action becomes "review". */}
      {!saveConflict && (groupFreshness.state === 'stale' || groupFreshness.state === 'unknown') && !groupFreshnessDismissed && (
        <DataFreshnessBanner
          entityKey="entityRecord"
          dirty={groupHasUnsavedChanges}
          deleted={groupFreshness.remotelyDeleted}
          unknown={groupFreshness.state === 'unknown'}
          diagnostics={groupFreshness.diagnostics}
          checking={groupFreshness.checking}
          canCheck={groupFreshness.canCheck}
          onCheckAgain={groupFreshness.checkAgain}
          onRefresh={groupHasUnsavedChanges ? undefined : handleRefreshGroup}
          refreshing={isRefreshingGroup}
          onDismiss={() => setGroupFreshnessDismissed(true)}
        />
      )}
</> };
}
