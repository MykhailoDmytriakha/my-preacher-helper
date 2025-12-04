import { adminDb } from '@/config/firebaseAdminConfig';
import { FieldValue } from 'firebase-admin/firestore';
import { StudyMaterial, StudyNote } from '@/models/models';
import { v4 as uuidv4 } from 'uuid';

const NOTES_COLLECTION = 'studyNotes';
const MATERIALS_COLLECTION = 'studyMaterials';

function computeDraft(note: Pick<StudyNote, 'tags' | 'scriptureRefs'>): boolean {
  return (note.tags?.length ?? 0) === 0 || (note.scriptureRefs?.length ?? 0) === 0;
}

export class StudiesRepository {
  async listNotes(userId: string): Promise<StudyNote[]> {
    const snapshot = await adminDb.collection(NOTES_COLLECTION).where('userId', '==', userId).get();
    return snapshot.docs.map((doc) => {
      const data = doc.data() as StudyNote;
      const normalized: StudyNote = {
        ...data,
        id: doc.id,
        scriptureRefs: data.scriptureRefs || [],
        tags: data.tags || [],
        materialIds: data.materialIds || [],
        isDraft: computeDraft(data),
      };
      return normalized;
    });
  }

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

  async createNote(payload: Omit<StudyNote, 'id' | 'createdAt' | 'updatedAt' | 'isDraft'>): Promise<StudyNote> {
    const now = new Date().toISOString();
    const note: Omit<StudyNote, 'id'> = {
      ...payload,
      createdAt: now,
      updatedAt: now,
    };
    // Do not persist derived/extraneous fields
    const { materialIds, relatedSermonIds, ...persistable } = note as any;

    const docRef = await adminDb.collection(NOTES_COLLECTION).add(persistable);
    return {
      ...note,
      id: docRef.id,
      isDraft: computeDraft(payload),
      materialIds: materialIds || [],
      relatedSermonIds: relatedSermonIds || [],
    };
  }

  async updateNote(id: string, updates: Partial<StudyNote>): Promise<StudyNote> {
    const existing = await this.getNote(id);
    if (!existing) throw new Error('Study note not found');

    const merged: StudyNote = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    merged.isDraft = computeDraft(merged);

    // Never persist derived fields
    const { isDraft, materialIds, relatedSermonIds, ...persistable } = merged as any;

    await adminDb.collection(NOTES_COLLECTION).doc(id).set(persistable, { merge: true });
    return merged;
  }

  async deleteNote(id: string): Promise<void> {
    // Remove from materials first to keep references clean
    const materialsWithNote = await adminDb
      .collection(MATERIALS_COLLECTION)
      .where('noteIds', 'array-contains', id)
      .get();
    if (!materialsWithNote.empty) {
      const batch = adminDb.batch();
      materialsWithNote.forEach((doc) => {
        const data = doc.data() as StudyMaterial;
        const filtered = (data.noteIds || []).filter((n) => n !== id);
        batch.update(doc.ref, { noteIds: filtered });
      });
      await batch.commit();
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
    const material: Omit<StudyMaterial, 'id'> = {
      ...payload,
      noteIds: Array.from(new Set(payload.noteIds)),
      createdAt: now,
      updatedAt: now,
    };
    const docRef = await adminDb.collection(MATERIALS_COLLECTION).add(material);
    const materialId = docRef.id;
    await this.addMaterialRefToNotes(material.noteIds, materialId);
    return { ...material, id: materialId };
  }

  async updateMaterial(id: string, updates: Partial<StudyMaterial>): Promise<StudyMaterial> {
    const existing = await this.getMaterial(id);
    if (!existing) throw new Error('Study material not found');

    const next: StudyMaterial = {
      ...existing,
      ...updates,
      noteIds: updates.noteIds ? Array.from(new Set(updates.noteIds)) : existing.noteIds,
      updatedAt: new Date().toISOString(),
    };

    // Sync note references
    if (updates.noteIds) {
      const added = next.noteIds.filter((n) => !existing.noteIds.includes(n));
      const removed = existing.noteIds.filter((n) => !next.noteIds.includes(n));
      await this.addMaterialRefToNotes(added, id);
      await this.removeMaterialRefFromNotes(removed, id);
    }

    await adminDb.collection(MATERIALS_COLLECTION).doc(id).set(next, { merge: true });
    return next;
  }

  async deleteMaterial(id: string): Promise<void> {
    const existing = await this.getMaterial(id);
    await adminDb.collection(MATERIALS_COLLECTION).doc(id).delete();
    if (existing) {
      await this.removeMaterialRefFromNotes(existing.noteIds, id);
    }
  }
}

export const studiesRepository = new StudiesRepository();
