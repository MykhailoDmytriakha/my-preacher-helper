import { FieldValue } from 'firebase-admin/firestore';

import { adminDb } from '@/config/firebaseAdminConfig';
import { StudyMaterial, StudyNote } from '@/models/models';


const NOTES_COLLECTION = 'studyNotes';
const MATERIALS_COLLECTION = 'studyMaterials';

function computeDraft(note: Pick<StudyNote, 'tags' | 'scriptureRefs'>): boolean {
  return (note.tags?.length ?? 0) === 0 || (note.scriptureRefs?.length ?? 0) === 0;
}

export class StudiesRepository {
  async getNote(id: string): Promise<StudyNote | null> {
    const doc = await adminDb.collection(NOTES_COLLECTION).doc(id).get();
    if (!doc.exists) return null;
    const data = doc.data() as StudyNote;
    const normalized: StudyNote = {
        ...data,
        id: doc.id,
        scriptureRefs: data.scriptureRefs || [],
        tags: data.tags || [],
        materialIds: data.materialIds || [],
        isDraft: computeDraft(data)
    };
    return normalized;
  }

  async deleteNote(id: string, ownerUid: string): Promise<void> {
    // Remove the reference from the OWNER's materials only. A material may reference
    // only its owner's notes (enforced in create/updateMaterial), so no foreign material
    // can legitimately point here; the ownerUid guard is defense-in-depth that stops a
    // delete from ever writing into another user's material.
    const materialsWithNote = await adminDb
      .collection(MATERIALS_COLLECTION)
      .where('noteIds', 'array-contains', id)
      .get();
    if (!materialsWithNote.empty) {
      const batch = adminDb.batch();
      let hasWrites = false;
      materialsWithNote.forEach((doc) => {
        const data = doc.data() as StudyMaterial;
        if (data.userId !== ownerUid) return; // never mutate a foreign-owned material
        batch.update(doc.ref, { noteIds: FieldValue.arrayRemove(id) });
        hasWrites = true;
      });
      if (hasWrites) await batch.commit();
    }
    await adminDb.collection(NOTES_COLLECTION).doc(id).delete();
  }

  async listMaterials(userId: string): Promise<StudyMaterial[]> {
    const snapshot = await adminDb.collection(MATERIALS_COLLECTION).where('userId', '==', userId).get();
    return snapshot.docs.map((doc) => {
      const data = doc.data() as StudyMaterial;
      return { ...data, id: doc.id };
    });
  }

  async getMaterial(id: string): Promise<StudyMaterial | null> {
    const doc = await adminDb.collection(MATERIALS_COLLECTION).doc(id).get();
    if (!doc.exists) return null;
    const data = doc.data() as StudyMaterial;
    return { ...data, id: doc.id };
  }

  // Returns the subset of noteIds that actually belong to ownerUid. Used to guarantee a
  // material can only ever cross-reference its own owner's notes, closing the cross-user
  // write where an attacker's material id would be injected into a victim's note.
  private async filterOwnedNoteIds(noteIds: string[] | undefined, ownerUid: string): Promise<string[]> {
    const unique = Array.from(new Set(noteIds || []));
    if (!unique.length) return [];
    const snaps = await Promise.all(
      unique.map((noteId) => adminDb.collection(NOTES_COLLECTION).doc(noteId).get())
    );
    return snaps
      .filter((snap) => snap.exists && (snap.data() as StudyNote).userId === ownerUid)
      .map((snap) => snap.id);
  }

  private async addMaterialRefToNotes(noteIds: string[], materialId: string) {
    if (!noteIds.length) return;
    const batch = adminDb.batch();
    noteIds.forEach((noteId) => {
      const ref = adminDb.collection(NOTES_COLLECTION).doc(noteId);
      batch.update(ref, { materialIds: FieldValue.arrayUnion(materialId) });
    });
    await batch.commit();
  }

  private async removeMaterialRefFromNotes(noteIds: string[], materialId: string) {
    if (!noteIds.length) return;
    const batch = adminDb.batch();
    noteIds.forEach((noteId) => {
      const ref = adminDb.collection(NOTES_COLLECTION).doc(noteId);
      batch.update(ref, { materialIds: FieldValue.arrayRemove(materialId) });
    });
    await batch.commit();
  }

  async createMaterial(payload: Omit<StudyMaterial, 'id' | 'createdAt' | 'updatedAt'>): Promise<StudyMaterial> {
    const now = new Date().toISOString();
    // Only keep references to notes the material's owner actually owns — never trust the
    // caller-supplied noteIds, or an attacker could inject this material into a victim note.
    const ownedNoteIds = await this.filterOwnedNoteIds(payload.noteIds, payload.userId);
    const material: Omit<StudyMaterial, 'id'> = {
      ...payload,
      noteIds: ownedNoteIds,
      createdAt: now,
      updatedAt: now,
    };
    const docRef = await adminDb.collection(MATERIALS_COLLECTION).add(material);
    const materialId = docRef.id;
    await this.addMaterialRefToNotes(ownedNoteIds, materialId);
    return { ...material, id: materialId };
  }

  async updateMaterial(id: string, updates: Partial<StudyMaterial>): Promise<StudyMaterial> {
    const materialRef = adminDb.collection(MATERIALS_COLLECTION).doc(id);

    return adminDb.runTransaction(async (transaction) => {
      const materialSnapshot = await transaction.get(materialRef);
      if (!materialSnapshot.exists) throw new Error('Study material not found');

      const existing = {
        ...(materialSnapshot.data() as StudyMaterial),
        id: materialSnapshot.id,
      };
      const next: StudyMaterial = {
        ...existing,
        ...updates,
        noteIds: updates.noteIds ? Array.from(new Set(updates.noteIds)) : existing.noteIds,
        updatedAt: new Date().toISOString(),
      };

      // Keep the material and both sides of its note references in the same retryable
      // transaction. arrayUnion/arrayRemove remain idempotent atomic transforms, while a
      // retry recomputes the diff from the latest committed material snapshot.
      if (updates.noteIds) {
        const candidateNoteIds = Array.from(new Set([...existing.noteIds, ...next.noteIds]));
        // Parallelize the ownership reads — all reads still precede any write in the txn.
        const noteSnapshots = await Promise.all(
          candidateNoteIds.map((noteId) =>
            transaction.get(adminDb.collection(NOTES_COLLECTION).doc(noteId))
          )
        );
        const ownedNoteIds = new Set<string>(
          noteSnapshots
            .filter((snap) => snap.exists && (snap.data() as StudyNote).userId === existing.userId)
            .map((snap) => snap.id)
        );

        next.noteIds = next.noteIds.filter((noteId) => ownedNoteIds.has(noteId));
        const added = next.noteIds.filter((noteId) => !existing.noteIds.includes(noteId));
        const removed = existing.noteIds.filter(
          (noteId) => !next.noteIds.includes(noteId) && ownedNoteIds.has(noteId)
        );

        added.forEach((noteId) => {
          transaction.update(adminDb.collection(NOTES_COLLECTION).doc(noteId), {
            materialIds: FieldValue.arrayUnion(id),
          });
        });
        removed.forEach((noteId) => {
          transaction.update(adminDb.collection(NOTES_COLLECTION).doc(noteId), {
            materialIds: FieldValue.arrayRemove(id),
          });
        });
      }

      transaction.set(materialRef, next, { merge: true });
      return next;
    });
  }

  async deleteMaterial(id: string): Promise<void> {
    const existing = await this.getMaterial(id);
    await adminDb.collection(MATERIALS_COLLECTION).doc(id).delete();
    if (existing) {
      // Only clean the reference from notes the owner actually owns — never write to a
      // foreign user's note, even when a legacy material still lists one.
      const ownedNoteIds = await this.filterOwnedNoteIds(existing.noteIds, existing.userId);
      await this.removeMaterialRefFromNotes(ownedNoteIds, id);
    }
  }
}

export const studiesRepository = new StudiesRepository();
