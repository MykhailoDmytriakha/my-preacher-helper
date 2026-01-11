import { adminDb, FieldValue } from '@/config/firebaseAdminConfig';
import { StudyNoteShareLink } from '@/models/models';

const SHARE_LINKS_COLLECTION = 'studyNoteShareLinks';

function normalizeShareLink(docId: string, data: Partial<StudyNoteShareLink>): StudyNoteShareLink {
  return {
    id: docId,
    noteId: data.noteId || '',
    ownerId: data.ownerId || '',
    token: data.token || '',
    createdAt: data.createdAt || new Date(0).toISOString(),
    viewCount: typeof data.viewCount === 'number' ? data.viewCount : 0,
  };
}

export class StudyNoteShareLinksRepository {
  async listByOwner(ownerId: string): Promise<StudyNoteShareLink[]> {
    const snapshot = await adminDb
      .collection(SHARE_LINKS_COLLECTION)
      .where('ownerId', '==', ownerId)
      .get();

    return snapshot.docs.map((doc) => normalizeShareLink(doc.id, doc.data() as Partial<StudyNoteShareLink>));
  }

  async getById(id: string): Promise<StudyNoteShareLink | null> {
    const doc = await adminDb.collection(SHARE_LINKS_COLLECTION).doc(id).get();
    if (!doc.exists) return null;
    return normalizeShareLink(doc.id, doc.data() as Partial<StudyNoteShareLink>);
  }

  async findByOwnerAndNoteId(ownerId: string, noteId: string): Promise<StudyNoteShareLink | null> {
    const snapshot = await adminDb
      .collection(SHARE_LINKS_COLLECTION)
      .where('ownerId', '==', ownerId)
      .where('noteId', '==', noteId)
      .limit(1)
      .get();

    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return normalizeShareLink(doc.id, doc.data() as Partial<StudyNoteShareLink>);
  }

  async findByToken(token: string): Promise<StudyNoteShareLink | null> {
    const snapshot = await adminDb
      .collection(SHARE_LINKS_COLLECTION)
      .where('token', '==', token)
      .limit(1)
      .get();

    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return normalizeShareLink(doc.id, doc.data() as Partial<StudyNoteShareLink>);
  }

  async createLink(params: { ownerId: string; noteId: string; token: string }): Promise<StudyNoteShareLink> {
    const now = new Date().toISOString();
    const payload: Omit<StudyNoteShareLink, 'id'> = {
      ownerId: params.ownerId,
      noteId: params.noteId,
      token: params.token,
      createdAt: now,
      viewCount: 0,
    };

    const docRef = await adminDb.collection(SHARE_LINKS_COLLECTION).add(payload);
    return { ...payload, id: docRef.id };
  }

  async incrementViewCount(id: string): Promise<void> {
    await adminDb
      .collection(SHARE_LINKS_COLLECTION)
      .doc(id)
      .set({ viewCount: FieldValue.increment(1) }, { merge: true });
  }

  async deleteLink(id: string): Promise<void> {
    await adminDb.collection(SHARE_LINKS_COLLECTION).doc(id).delete();
  }
}

export const studyNoteShareLinksRepository = new StudyNoteShareLinksRepository();
