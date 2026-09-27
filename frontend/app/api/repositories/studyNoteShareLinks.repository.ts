import { adminDb, FieldValue } from '@/config/firebaseAdminConfig';
import { ScriptureReference, StudyNote, StudyNoteShareLink } from '@/models/models';

const SHARE_LINKS_COLLECTION = 'studyNoteShareLinks';

/** What a share link makes public: the text, plus what a link preview names the note by. */
export interface SharedNote {
  shareLink: StudyNoteShareLink;
  content: string;
  title?: string;
  scriptureRefs: ScriptureReference[];
  type: NonNullable<StudyNote['type']>;
}

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/**
 * A reference as the public may see it: book and coordinates only. The stored object can also
 * carry the author's own `text` snippet, which a link never publishes.
 */
function publicReference(value: unknown): ScriptureReference | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.book !== 'string' || !raw.book.trim()) return null;
  const chapter = finiteNumber(raw.chapter);
  const toChapter = finiteNumber(raw.toChapter);
  const fromVerse = finiteNumber(raw.fromVerse);
  const toVerse = finiteNumber(raw.toVerse);
  return {
    id: typeof raw.id === 'string' ? raw.id : '',
    book: raw.book,
    ...(chapter !== undefined ? { chapter } : {}),
    ...(toChapter !== undefined ? { toChapter } : {}),
    ...(fromVerse !== undefined ? { fromVerse } : {}),
    ...(toVerse !== undefined ? { toVerse } : {}),
  };
}

function toSharedNote(shareLink: StudyNoteShareLink, data: Record<string, unknown>, content: string): SharedNote {
  const title = typeof data.title === 'string' ? data.title.trim() : '';
  const scriptureRefs = Array.isArray(data.scriptureRefs)
    ? data.scriptureRefs.map(publicReference).filter((reference): reference is ScriptureReference => reference !== null)
    : [];
  return {
    shareLink,
    content,
    ...(title ? { title } : {}),
    scriptureRefs,
    type: data.type === 'question' ? 'question' : 'note',
  };
}

function isRetired(data: Record<string, unknown>): boolean {
  const metadata = data._dataEngine;
  return data.revoked === true || Boolean(metadata && typeof metadata === 'object' && 'deleted' in metadata && metadata.deleted === true);
}

function activeLink(docId: string, data: Record<string, unknown>): StudyNoteShareLink | null {
  if (isRetired(data) || typeof data.ownerId !== 'string' || !data.ownerId || typeof data.noteId !== 'string' || !data.noteId || typeof data.token !== 'string' || !data.token) return null;
  return normalizeShareLink(docId, data);
}

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

    return snapshot.docs.flatMap(doc => {
      const link = activeLink(doc.id, doc.data());
      return link?.ownerId === ownerId ? [link] : [];
    });
  }

  async getById(id: string): Promise<StudyNoteShareLink | null> {
    const doc = await adminDb.collection(SHARE_LINKS_COLLECTION).doc(id).get();
    if (!doc.exists) return null;
    return activeLink(doc.id, doc.data()!);
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
    const link = activeLink(doc.id, doc.data());
    return link?.ownerId === ownerId && link.noteId === noteId ? link : null;
  }

  async findByToken(token: string): Promise<StudyNoteShareLink | null> {
    const snapshot = await adminDb
      .collection(SHARE_LINKS_COLLECTION)
      .where('token', '==', token)
      .limit(1)
      .get();

    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    const link = activeLink(doc.id, doc.data());
    return link?.token === token ? link : null;
  }

  /** Token authorization and content are read from one consistent transaction. */
  async readSharedNote(token: string): Promise<SharedNote | null> {
    return adminDb.runTransaction(async transaction => {
      const links = await transaction.get(adminDb.collection(SHARE_LINKS_COLLECTION).where('token', '==', token).limit(1));
      if (links.empty) return null;
      const link = activeLink(links.docs[0].id, links.docs[0].data());
      if (!link || link.token !== token) return null;
      const note = await transaction.get(adminDb.collection('studyNotes').doc(link.noteId));
      const data = note.data();
      if (!data || isRetired(data) || data.userId !== link.ownerId || typeof data.content !== 'string') return null;
      return toSharedNote(link, data, data.content);
    });
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

    const docRef = adminDb.collection(SHARE_LINKS_COLLECTION).doc();
    // Transitional legacy writer: this is not a DataCommand/receipt migration.
    // Contending on the note prevents a link from being added after its deletion.
    return adminDb.runTransaction(async transaction => {
      const note = await transaction.get(adminDb.collection('studyNotes').doc(params.noteId));
      const data = note.data();
      if (!data || isRetired(data) || data.userId !== params.ownerId) throw Object.assign(new Error('Study note unavailable'), { code: 'permission-denied' });
      transaction.set(docRef, payload);
      return { ...payload, id: docRef.id };
    });
  }

  async incrementViewCount(id: string): Promise<void> {
    const reference = adminDb.collection(SHARE_LINKS_COLLECTION).doc(id);
    // A late public request must not recreate a physically deleted or retired link.
    await adminDb.runTransaction(async transaction => {
      const document = await transaction.get(reference);
      const data = document.data();
      if (!data || !activeLink(id, data)) return;
      transaction.set(reference, { viewCount: FieldValue.increment(1) }, { merge: true });
    });
  }

  async deleteLink(id: string): Promise<void> {
    await adminDb.collection(SHARE_LINKS_COLLECTION).doc(id).delete();
  }
}

export const studyNoteShareLinksRepository = new StudyNoteShareLinksRepository();
