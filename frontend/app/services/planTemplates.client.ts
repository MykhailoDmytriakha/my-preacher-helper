import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

import { getClientDb } from '@/config/firebaseClientDb';
import { PlanTemplate, SermonOutline } from '@/models/models';
import { conflictSafeUpdate, revisionBump } from '@/services/conflictSafeUpdate.client';

/** A template's name and structure are edited together by one person. */
export const PLAN_TEMPLATE_AGGREGATE = 'template';

// Client-SDK CRUD for plan templates (offline replica in IndexedDB + Security Rules).
// The server route was removed in the Phase 5 cleanup, so planTemplate.service.ts
// calls these unconditionally. Docs are keyed by a client-minted id so writes are
// idempotent on replay.
const COLLECTION = 'planTemplates';

const normalizeStructure = (structure?: Partial<SermonOutline>): SermonOutline => ({
  introduction: structure?.introduction ?? [],
  main: structure?.main ?? [],
  conclusion: structure?.conclusion ?? [],
});

export async function getPlanTemplatesViaClient(userId: string): Promise<PlanTemplate[]> {
  const db = getClientDb();
  const snap = await getDocs(query(collection(db, COLLECTION), where('userId', '==', userId)));
  return snap.docs
    .map((d) => {
      const data = d.data() as Omit<PlanTemplate, 'id'>;
      return { ...data, id: d.id, structure: normalizeStructure(data.structure) };
    })
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

export async function createPlanTemplateViaClient(payload: {
  id: string;
  userId: string;
  name: string;
  structure: SermonOutline;
}): Promise<PlanTemplate> {
  const db = getClientDb();
  const now = new Date().toISOString();
  const data = {
    userId: payload.userId,
    name: payload.name,
    structure: normalizeStructure(payload.structure),
    createdAt: now,
    updatedAt: now,
  };
  // Idempotent client-id create: setDoc directly, with NO getDoc pre-check — a read
  // on a not-yet-existing doc is denied by the Security Rules (ownsExisting) and
  // would abort the whole write. setDoc creates (or harmlessly re-writes on replay).
  await setDoc(doc(db, COLLECTION, payload.id), data);
  return { ...data, id: payload.id };
}

export async function updatePlanTemplateViaClient(
  id: string,
  updates: Partial<Pick<PlanTemplate, 'name' | 'structure'>>,
  /** Revision this edit was built from; `null` keeps the unguarded legacy path. */
  expectedRevision: number | null = null,
  /** Owner, so an offline attempt can be queued as an intent and replayed. */
  ownerUid?: string
): Promise<void> {
  const db = getClientDb();
  const patch: { updatedAt: string; name?: string; structure?: SermonOutline } = {
    updatedAt: new Date().toISOString(),
  };
  if (updates.name !== undefined) patch.name = updates.name;
  if (updates.structure !== undefined) patch.structure = normalizeStructure(updates.structure);
  const ref = doc(db, COLLECTION, id);
  // GUARDED PATH — see conflictSafeUpdate.client.ts. No revision stated = old path.
  if (expectedRevision !== null) {
    await conflictSafeUpdate(ref, patch, 'Plan template not found', {
      aggregate: PLAN_TEMPLATE_AGGREGATE,
      expectedRevision,
      outboxRoute: ownerUid
        ? { uid: ownerUid, collection: COLLECTION, docId: id, savedAt: Date.now() }
        : undefined,
    });
    return;
  }
  // Unguarded writers must STILL advance the counter — see revisionBump.
  await updateDoc(ref, { ...patch, ...revisionBump(PLAN_TEMPLATE_AGGREGATE) });
}

export async function deletePlanTemplateViaClient(id: string): Promise<void> {
  const db = getClientDb();
  await deleteDoc(doc(db, COLLECTION, id));
}
