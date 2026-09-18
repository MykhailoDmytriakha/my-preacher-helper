import { FieldValue } from 'firebase-admin/firestore';

import { adminDb } from '@/config/firebaseAdminConfig';
import { assertLegacyWritable, runLegacyTransaction } from '@/data-engine/legacyBoundary.server';
import { StudyMaterial, StudyNote } from '@/models/models';

import type { DocumentSnapshot, Transaction } from 'firebase-admin/firestore';

const NOTES_COLLECTION = 'studyNotes';
const MATERIALS_COLLECTION = 'studyMaterials';
const MAX_RELATED = 99;
const editableMaterialFields = new Set(['title', 'description', 'type', 'noteIds', 'sections']);

function budget(count: number): void {
  if (count > MAX_RELATED) throw Object.assign(new Error('Legacy cascade exceeds its atomic write budget'), { code: 'data-engine-required' });
}
function owned(snapshot: DocumentSnapshot, owner: string): boolean {
  return snapshot.exists && snapshot.data()?.userId === owner;
}
function requireOwner(snapshot: DocumentSnapshot, owner?: string): void {
  if (snapshot.exists && owner !== undefined && !owned(snapshot, owner)) throw Object.assign(new Error('Forbidden'), { code: 'permission-denied', status: 403 });
  assertLegacyWritable(snapshot.data());
}
function noteIds(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !id || id.includes('/') || id === '.' || id === '..')) {
    throw Object.assign(new Error('Invalid noteIds'), { code: 'invalid-argument', status: 400 });
  }
  const ids = [...new Set(value)] as string[];
  budget(ids.length);
  return ids;
}
async function readNotes(transaction: Transaction, ids: string[], owner: string): Promise<DocumentSnapshot[]> {
  budget(ids.length);
  const snapshots = await Promise.all(ids.map(id => transaction.get(adminDb.collection(NOTES_COLLECTION).doc(id))));
  const result = snapshots.filter(snapshot => owned(snapshot, owner));
  result.forEach(snapshot => assertLegacyWritable(snapshot.data()));
  return result;
}
function computeDraft(note: Pick<StudyNote, 'tags' | 'scriptureRefs'>): boolean {
  return (note.tags?.length ?? 0) === 0 || (note.scriptureRefs?.length ?? 0) === 0;
}

export class StudiesRepository {
  async getNote(id: string): Promise<StudyNote | null> {
    const doc = await adminDb.collection(NOTES_COLLECTION).doc(id).get();
    if (!doc.exists) return null;
    const data = doc.data() as StudyNote;
    return { ...data, id: doc.id, scriptureRefs: data.scriptureRefs || [], tags: data.tags || [],
      materialIds: data.materialIds || [], isDraft: computeDraft(data) };
  }

  async deleteNote(id: string, ownerUid: string): Promise<void> {
    const reference = adminDb.collection(NOTES_COLLECTION).doc(id);
    await runLegacyTransaction(async transaction => {
      const note = await transaction.get(reference);
      requireOwner(note, ownerUid);
      if (!note.exists) return;
      const materials = await transaction.get(adminDb.collection(MATERIALS_COLLECTION)
        .where('userId', '==', ownerUid).where('noteIds', 'array-contains', id).limit(101));
      const links = await transaction.get(adminDb.collection('studyNoteShareLinks')
        .where('ownerId', '==', ownerUid).where('noteId', '==', id).limit(101));
      budget(materials.docs.length + links.docs.length);
      // All reads and ownership checks precede effects; a protected participant
      // refuses the whole cleanup, including the primary physical deletion.
      const ownedMaterials = materials.docs.filter(snapshot => owned(snapshot, ownerUid));
      const ownedLinks = links.docs.filter(snapshot => snapshot.data()?.ownerId === ownerUid && snapshot.data()?.noteId === id);
      [...ownedMaterials, ...ownedLinks].forEach(snapshot => assertLegacyWritable(snapshot.data()));
      ownedMaterials.forEach(snapshot => transaction.update(snapshot.ref, { noteIds: FieldValue.arrayRemove(id) }));
      ownedLinks.forEach(snapshot => transaction.delete(snapshot.ref));
      transaction.delete(reference);
    });
  }

  async listMaterials(userId: string): Promise<StudyMaterial[]> {
    const snapshot = await adminDb.collection(MATERIALS_COLLECTION).where('userId', '==', userId).get();
    return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as StudyMaterial));
  }

  async getMaterial(id: string): Promise<StudyMaterial | null> {
    const doc = await adminDb.collection(MATERIALS_COLLECTION).doc(id).get();
    return doc.exists ? { ...doc.data(), id: doc.id } as StudyMaterial : null;
  }

  async createMaterial(payload: Omit<StudyMaterial, 'id' | 'createdAt' | 'updatedAt'>): Promise<StudyMaterial> {
    assertLegacyWritable(payload);
    const reference = adminDb.collection(MATERIALS_COLLECTION).doc();
    const ids = noteIds(payload.noteIds);
    const now = new Date().toISOString();
    return runLegacyTransaction(async transaction => {
      const collision = await transaction.get(reference);
      requireOwner(collision, payload.userId);
      if (collision.exists) throw Object.assign(new Error('Study material already exists'), { status: 409 });
      const notes = await readNotes(transaction, ids, payload.userId);
      const material = { ...payload, noteIds: notes.map(snapshot => snapshot.id), createdAt: now, updatedAt: now };
      transaction.create(reference, material);
      notes.forEach(snapshot => transaction.update(snapshot.ref, { materialIds: FieldValue.arrayUnion(reference.id) }));
      return { ...material, id: reference.id };
    });
  }

  async updateMaterial(id: string, updates: Partial<StudyMaterial>, ownerUid?: string): Promise<StudyMaterial> {
    assertLegacyWritable(updates);
    if (Object.keys(updates).some(field => !editableMaterialFields.has(field) && field !== 'userId')) {
      throw Object.assign(new Error('Unsupported material field'), { code: 'invalid-argument', status: 400 });
    }
    const reference = adminDb.collection(MATERIALS_COLLECTION).doc(id);
    return runLegacyTransaction(async transaction => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw new Error('Study material not found');
      requireOwner(snapshot, ownerUid);
      const existing = { ...snapshot.data(), id } as StudyMaterial;
      if (updates.userId !== undefined && updates.userId !== existing.userId) throw Object.assign(new Error('Cannot change userId'), { code: 'permission-denied', status: 403 });
      const oldIds = noteIds(existing.noteIds);
      const next = { ...existing, ...updates, id, userId: existing.userId, updatedAt: new Date().toISOString() };
      if (updates.noteIds !== undefined) {
        const requested = noteIds(updates.noteIds);
        const notes = await readNotes(transaction, [...new Set([...oldIds, ...requested])], existing.userId);
        const ownedIds = new Set(notes.map(note => note.id));
        next.noteIds = requested.filter(noteId => ownedIds.has(noteId));
        for (const note of notes) {
          if (next.noteIds.includes(note.id) && !oldIds.includes(note.id)) transaction.update(note.ref, { materialIds: FieldValue.arrayUnion(id) });
          if (oldIds.includes(note.id) && !next.noteIds.includes(note.id)) transaction.update(note.ref, { materialIds: FieldValue.arrayRemove(id) });
        }
      }
      transaction.set(reference, next, { merge: true });
      return next;
    });
  }

  async deleteMaterial(id: string, ownerUid?: string): Promise<void> {
    const reference = adminDb.collection(MATERIALS_COLLECTION).doc(id);
    await runLegacyTransaction(async transaction => {
      const material = await transaction.get(reference);
      requireOwner(material, ownerUid);
      if (!material.exists) return;
      const data = material.data() as StudyMaterial;
      const reverse = await transaction.get(adminDb.collection(NOTES_COLLECTION)
        .where('userId', '==', data.userId).where('materialIds', 'array-contains', id).limit(101));
      const ids = [...new Set([...noteIds(data.noteIds), ...reverse.docs.map(note => note.id)])];
      const notes = await readNotes(transaction, ids, data.userId);
      notes.forEach(note => transaction.update(note.ref, { materialIds: FieldValue.arrayRemove(id) }));
      transaction.delete(reference);
    });
  }
}

export const studiesRepository = new StudiesRepository();
