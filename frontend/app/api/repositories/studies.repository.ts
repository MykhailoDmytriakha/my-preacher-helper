import { adminDb } from '@/config/firebaseAdminConfig';
import { StudyMaterial, StudyNote } from '@/models/models';
import { isEngineTombstone } from '@/utils/engineTombstone';

const NOTES_COLLECTION = 'studyNotes';
const MATERIALS_COLLECTION = 'studyMaterials';

function computeDraft(note: Pick<StudyNote, 'tags' | 'scriptureRefs'>): boolean {
  return (note.tags?.length ?? 0) === 0 || (note.scriptureRefs?.length ?? 0) === 0;
}

/**
 * THE SERVER'S READS OF STUDY NOTES AND MATERIALS. Both are written only through the data engine;
 * a document the engine deleted is a tombstone, and a tombstone written before 2026-09-18 still
 * carries userId — so every read here treats it as absent rather than as a blank live record.
 */
export class StudiesRepository {
  async getNote(id: string): Promise<StudyNote | null> {
    const doc = await adminDb.collection(NOTES_COLLECTION).doc(id).get();
    if (!doc.exists || isEngineTombstone(doc.data())) return null;
    const data = doc.data() as StudyNote;
    return { ...data, id: doc.id, scriptureRefs: data.scriptureRefs || [], tags: data.tags || [],
      materialIds: data.materialIds || [], isDraft: computeDraft(data) };
  }

  async listMaterials(userId: string): Promise<StudyMaterial[]> {
    const snapshot = await adminDb.collection(MATERIALS_COLLECTION).where('userId', '==', userId).get();
    return snapshot.docs.filter(doc => !isEngineTombstone(doc.data())).map(doc => ({ ...doc.data(), id: doc.id } as StudyMaterial));
  }

  async getMaterial(id: string): Promise<StudyMaterial | null> {
    const doc = await adminDb.collection(MATERIALS_COLLECTION).doc(id).get();
    return doc.exists && !isEngineTombstone(doc.data()) ? { ...doc.data(), id: doc.id } as StudyMaterial : null;
  }
}

export const studiesRepository = new StudiesRepository();
