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
  updates: Partial<Pick<PlanTemplate, 'name' | 'structure'>>
): Promise<void> {
  const db = getClientDb();
  const patch: { updatedAt: string; name?: string; structure?: SermonOutline } = {
    updatedAt: new Date().toISOString(),
  };
  if (updates.name !== undefined) patch.name = updates.name;
  if (updates.structure !== undefined) patch.structure = normalizeStructure(updates.structure);
  await updateDoc(doc(db, COLLECTION, id), patch);
}

export async function deletePlanTemplateViaClient(id: string): Promise<void> {
  const db = getClientDb();
  await deleteDoc(doc(db, COLLECTION, id));
}
