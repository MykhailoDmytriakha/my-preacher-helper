import { collection, getDocs, query, where } from 'firebase/firestore';

import { getClientDb } from '@/config/firebaseClientDb';
import { Tag } from '@/models/models';
import { isStructureTag } from '@/utils/structureTags';

// Tags are written only through the data engine (engineOwnedCollections.ts). This read stays for
// the structure board, which still loads the person's tags on its own (useSermonStructureData).

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
