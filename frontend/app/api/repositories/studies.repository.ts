import { adminDb } from '@/config/firebaseAdminConfig';
import { StudyMaterial, StudyNote } from '@/models/models';
import { isEngineTombstone } from '@/utils/engineTombstone';
import { withNoteReferenceBibles } from '@/utils/scriptureReferenceNumbering';

import type { AppLocale } from '@/utils/appLocale';

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
  /** `author`: the language the author's interface speaks, from their request — their old references are read in it. */
  async getNote(id: string, author?: AppLocale): Promise<StudyNote | null> {
    const doc = await adminDb.collection(NOTES_COLLECTION).doc(id).get();
    if (!doc.exists || isEngineTombstone(doc.data())) return null;
    // References stored before they kept their Bible are read in the author's language; where the
    // request did not say it, in the language of the note's words, and a note with none as English.
    const data = withNoteReferenceBibles(doc.data() as StudyNote, author);
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
