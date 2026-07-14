import { addDoc, collection, getDocs, query, updateDoc, where } from 'firebase/firestore';

import { getClientDb } from '@/config/firebaseClientDb';
import { Tag } from '@/models/models';
import { getAuthenticatedRequestHeaders } from '@/utils/authenticatedRequest';
import { isStructureTag } from '@/utils/structureTags';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE;

// Tags live on the client Firestore SDK for reads and own-doc writes. DELETE
// stays on the server because it cascades tag removal into sermon thoughts.

type TagPayload = { requiredTags: Tag[]; customTags: Tag[] };

// Client-SDK read path — mirrors the server getCustomTags(): the user's own
// non-required tags, minus legacy structural docs. Same shape as GET /api/tags.
async function getTagsViaClient(userId: string): Promise<TagPayload> {
  const db = getClientDb();
  const snap = await getDocs(
    query(collection(db, 'tags'), where('userId', '==', userId), where('required', '==', false))
  );
  const customTags = snap.docs.flatMap((d) => {
    const data = d.data() as Tag;
    const id = d.id;
    if (isStructureTag(id) || (data.name && isStructureTag(data.name))) return [];
    return [{ ...data, id }];
  });
  return { requiredTags: [], customTags };
}

export async function getTags(userId: string) {
  return getTagsViaClient(userId);
}

// Client-SDK write paths mirror the old server logic; DELETE stays on the
// server because it cascades tag removal into every sermon's thoughts.
async function addCustomTagViaClient(tag: Tag): Promise<Tag> {
  if (isStructureTag(tag.name)) throw new Error('Reserved tag name');
  const db = getClientDb();
  const dup = await getDocs(
    query(collection(db, 'tags'), where('userId', '==', tag.userId), where('name', '==', tag.name))
  );
  if (!dup.empty) throw new Error('Tag with same name and userId already exists');
  await addDoc(collection(db, 'tags'), {
    userId: tag.userId,
    name: tag.name,
    color: tag.color,
    required: false,
  });
  return tag;
}

async function updateTagViaClient(tag: Tag): Promise<{ message: string; tag: Tag }> {
  const db = getClientDb();
  const snap = await getDocs(
    query(collection(db, 'tags'), where('userId', '==', tag.userId), where('name', '==', tag.name))
  );
  if (snap.empty) throw new Error('Tag not found');
  await updateDoc(snap.docs[0].ref, { name: tag.name, color: tag.color });
  return { message: 'Tag updated', tag };
}

export async function addCustomTag(tag: Tag) {
  return addCustomTagViaClient(tag);
}

export async function removeCustomTag(userId: string, tagName: string) {
  try {
    const authHeaders = await getAuthenticatedRequestHeaders();
    const res = await fetch(`${API_BASE}/api/tags?userId=${userId}&tagName=${encodeURIComponent(tagName)}`, {
      method: 'DELETE',
      headers: authHeaders,
    });
    if (!res.ok) {
      throw new Error('Failed to remove custom tag');
    }
    const data = await res.json();
    return data;
  } catch (error) {
    console.error('removeCustomTag: Error removing custom tag', error);
    throw error;
  }
}

export async function updateTag(tag: Tag) {
  return updateTagViaClient(tag);
}
