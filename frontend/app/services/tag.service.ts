import { addDoc, collection, getDocs, query, updateDoc, where } from 'firebase/firestore';

import { getClientDb } from '@/config/firebaseClientDb';
import { Tag } from '@/models/models';
import { isStructureTag } from '@/utils/structureTags';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE;

// Strangler-fig flag: when ON, tag READS come from the client Firestore SDK (offline
// replica + deployed Security Rules) instead of the /api/tags server route. Writes
// still go through the server for now (delete cascades tag removal into sermons).
// Default OFF — behaviour is identical to before unless explicitly enabled.
const USE_CLIENT_TAGS = process.env.NEXT_PUBLIC_USE_CLIENT_TAGS === 'true';

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

// NOTE: writes intentionally do NOT pre-check connectivity — see groups.service.
// Reads also attempt the fetch (and fall back to React Query's persisted cache
// on failure) rather than returning empty, which would clobber the cache.
export async function getTags(userId: string) {
  if (USE_CLIENT_TAGS && typeof window !== 'undefined') {
    return getTagsViaClient(userId);
  }
  try {
    const res = await fetch(`${API_BASE}/api/tags?userId=${userId}`, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error('Failed to fetch tags');
    }
    const data = await res.json();
    return data;
  } catch (error) {
    console.error('getTags: Error fetching tags', error);
    throw error;
  }
}

// Client-SDK write paths (behind the same flag). Mirror the server logic; DELETE stays
// on the server because it cascades tag removal into every sermon's thoughts.
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
  if (USE_CLIENT_TAGS && typeof window !== 'undefined') return addCustomTagViaClient(tag);
  try {
    const res = await fetch(`${API_BASE}/api/tags`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(tag)
    });
    if (!res.ok) {
      try {
        const data = await res.json();
        throw new Error(data?.message || 'Failed to add custom tag');
      } catch {
        throw new Error('Failed to add custom tag');
      }
    }
    return tag;
  } catch (error) {
    console.error('addCustomTag: Error adding custom tag', error);
    throw error;
  }
}

export async function removeCustomTag(userId: string, tagName: string) {
  try {
    const res = await fetch(`${API_BASE}/api/tags?userId=${userId}&tagName=${encodeURIComponent(tagName)}`, {
      method: 'DELETE',
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
  if (USE_CLIENT_TAGS && typeof window !== 'undefined') return updateTagViaClient(tag);
  try {
    const res = await fetch(`${API_BASE}/api/tags`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(tag)
    });
    if (!res.ok) {
      throw new Error('Failed to update tag');
    }
    const data = await res.json();
    return data;
  } catch (error) {
    console.error('updateTag: Error updating tag', error);
    throw error;
  }
}
