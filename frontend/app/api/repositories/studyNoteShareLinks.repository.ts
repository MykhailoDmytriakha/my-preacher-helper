import { adminDb } from '@/config/firebaseAdminConfig';
import { ScriptureReference, StudyNote, StudyNoteShareLink } from '@/models/models';
import { APP_LOCALES, type AppLocale } from '@/utils/appLocale';
import { isBibleId } from '@/utils/bibles';
import { withNoteReferenceBibles } from '@/utils/scriptureReferenceNumbering';

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
 * A reference as the public may see it: book, coordinates and the Bible they are numbered by. The
 * stored object can also carry the author's own `text` snippet, which a link never publishes.
 */
function publicReference(value: unknown): ScriptureReference | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.book !== 'string' || !raw.book.trim()) return null;
  const chapter = finiteNumber(raw.chapter);
  const toChapter = finiteNumber(raw.toChapter);
  const fromVerse = finiteNumber(raw.fromVerse);
  const toVerse = finiteNumber(raw.toVerse);
  const endChapter = finiteNumber(raw.endChapter);
  // The chapter the last verse stands in, for a run past its chapter's end (`ScriptureReference.toVerseChapter`).
  const toVerseChapter = finiteNumber(raw.toVerseChapter);
  return {
    id: typeof raw.id === 'string' ? raw.id : '',
    ...(isBibleId(raw.bible) ? { bible: raw.bible } : {}),
    book: raw.book,
    ...(chapter !== undefined ? { chapter } : {}),
    ...(toChapter !== undefined ? { toChapter } : {}),
    ...(fromVerse !== undefined ? { fromVerse } : {}),
    ...(toVerse !== undefined ? { toVerse } : {}),
    ...(endChapter !== undefined ? { endChapter } : {}),
    ...(toVerseChapter !== undefined ? { toVerseChapter } : {}),
  };
}

function toSharedNote(shareLink: StudyNoteShareLink, data: Record<string, unknown>, content: string): SharedNote {
  const title = typeof data.title === 'string' ? data.title.trim() : '';
  const stored = Array.isArray(data.scriptureRefs)
    ? data.scriptureRefs.map(publicReference).filter((reference): reference is ScriptureReference => reference !== null)
    : [];
  // An old reference is read in the language the author's interface spoke when the link was made; a
  // link made before that was kept reads it in the language of the note's words.
  // Its type too: an older analysis's run past its chapter is read as the screens read it (`olderAnalysisRun`).
  const { scriptureRefs } = withNoteReferenceBibles({ title, content, type: typeof data.type === 'string' ? data.type : undefined, scriptureRefs: stored }, shareLink.authorLanguage);
  return {
    shareLink,
    content,
    ...(title ? { title } : {}),
    scriptureRefs,
    type: data.type === 'question' || data.type === 'comment' ? data.type : 'note',
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
    ...(APP_LOCALES.includes(data.authorLanguage as AppLocale) ? { authorLanguage: data.authorLanguage } : {}),
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



}

export const studyNoteShareLinksRepository = new StudyNoteShareLinksRepository();
