import { FieldValue } from "firebase-admin/firestore";

import { adminDb } from "@/config/firebaseAdminConfig";
import { assertLegacyWritable, runLegacyTransaction } from '@/data-engine/legacyBoundary.server';
import { Tag } from "@/models/models";
import {
  getTranslationKeyForTag as getStructureTranslationKeyForTag,
  isStructureTag,
} from "@/utils/structureTags";

// Translation key constants
const TAG_TRANSLATION_KEYS = {
  INTRODUCTION: "tags.introduction",
  MAIN_PART: "tags.mainPart",
  CONCLUSION: "tags.conclusion",
} as const;

// Define the mapping of required tag IDs to their translation keys
export const REQUIRED_TAG_TRANSLATIONS = {
  // Standard lowercase versions
  "intro": TAG_TRANSLATION_KEYS.INTRODUCTION,
  "main": TAG_TRANSLATION_KEYS.MAIN_PART,
  "conclusion": TAG_TRANSLATION_KEYS.CONCLUSION,

  // Capitalized versions
  "Intro": TAG_TRANSLATION_KEYS.INTRODUCTION,
  "Main": TAG_TRANSLATION_KEYS.MAIN_PART,
  "Conclusion": TAG_TRANSLATION_KEYS.CONCLUSION,

  // Russian versions
  "Вступление": TAG_TRANSLATION_KEYS.INTRODUCTION,
  "Основная часть": TAG_TRANSLATION_KEYS.MAIN_PART,
  "Заключение": TAG_TRANSLATION_KEYS.CONCLUSION
};

// Helper function to check if a tag name is a required tag
export function isRequiredTag(tagName: string): boolean {
  return isStructureTag(tagName);
}

// Get translation key for a tag name if it's a required tag
export function getTranslationKeyForTag(tagName: string): string | undefined {
  return getStructureTranslationKeyForTag(tagName) ?? undefined;
}

export async function getCustomTags(userId: string) {
  try {
    const tagsRef = adminDb.collection("tags");
    const querySnapshot = await tagsRef
      .where("required", "==", false)
      .where("userId", "==", userId)
      .get();
      
    const customTags = querySnapshot.docs.flatMap((doc) => {
      const data = doc.data();
      const tagId = doc.id;
      const tagName = data.name;
      
      // Legacy structural tags may still exist as required=false docs. They are no
      // longer valid custom tags and must not be offered to AI or UI tag pickers.
      if (isRequiredTag(tagId) || (tagName && isRequiredTag(tagName))) {
        return [];
      }
      
      return [{ ...data, id: tagId }];
    });
    
    return customTags as Tag[];
  } catch (error) {
    console.error(`Error fetching custom tags for user ${userId}:`, error);
    throw error;
  }
}

export async function saveTag(tag: Tag) {
  try {
    const tagsRef = adminDb.collection("tags");
    // Prevent creating a custom tag with reserved structure names
    if (isRequiredTag(tag.name)) {
      throw new Error("RESERVED_NAME");
    }
    if (tag.required) throw new Error('RESERVED_NAME');
    assertLegacyWritable(tag);
    const reference = tagsRef.doc();
    await runLegacyTransaction(async transaction => {
      const existing = await transaction.get(tagsRef.where('name', '==', tag.name).where('userId', '==', tag.userId).limit(1));
      const collision = await transaction.get(reference);
      if (!existing.empty) throw new Error('Tag with same name and userId already exists');
      assertLegacyWritable(collision.data());
      if (collision.exists) throw new Error('Tag identity already exists');
      transaction.create(reference, tag);
    });
  } catch (error) {
    console.error("Error saving tag:", error);
    throw error;
  }
}

export async function deleteTag(userId: string, tagName: string) {
  console.log(`Firestore: deleting tag ${tagName} for user ${userId}`);
  try {
    const tagsQuery = adminDb.collection('tags').where('userId', '==', userId).where('name', '==', tagName).limit(1);
    const sermonsQuery = adminDb.collection('sermons').where('userId', '==', userId).limit(101);
    return await runLegacyTransaction(async transaction => {
      const tags = await transaction.get(tagsQuery);
      if (tags.empty) throw new Error('Tag not found');
      const tag = tags.docs[0];
      if (tag.data().userId !== userId) throw new Error('Forbidden');
      if (tag.data().required || isRequiredTag(tagName) || isRequiredTag(tag.id)) throw new Error('RESERVED_NAME');
      const sermons = await transaction.get(sermonsQuery);
      if (sermons.docs.length > 99) throw Object.assign(new Error('Legacy cascade exceeds its atomic write budget'), { code: 'data-engine-required' });
      let affectedThoughts = 0;
      for (const sermon of sermons.docs) {
        const data = sermon.data();
        if (data.userId !== userId) continue;
        const thoughts = Array.isArray(data.thoughts) ? data.thoughts as Record<string, unknown>[] : [];
        const updated = thoughts.map(thought => {
          const tags = Array.isArray(thought.tags) ? thought.tags as string[] : [];
          const kept = tags.filter(value => value !== tagName);
          affectedThoughts += tags.length - kept.length;
          return kept.length === tags.length ? thought : { ...thought, tags: kept };
        });
        if (JSON.stringify(updated) !== JSON.stringify(thoughts)) transaction.update(sermon.ref, { thoughts: updated, 'rev.thoughts': FieldValue.increment(1) });
      }
      transaction.delete(tags.docs[0].ref);
      return { affectedThoughts };
    });

  } catch (error) {
    console.error(`Error deleting tag ${tagName} for user ${userId}:`, error);
    throw error;
  }
}

export async function updateTagInDb(tag: Tag) {
  try {
    const tagsRef = adminDb.collection('tags');
    if (tag.required || isRequiredTag(tag.name)) throw new Error('RESERVED_NAME');
    return await runLegacyTransaction(async transaction => {
      const snapshot = await transaction.get(tagsRef.where('userId', '==', tag.userId).where('name', '==', tag.name).limit(1));
      if (snapshot.empty) throw new Error('Tag not found');
      const current = snapshot.docs[0];
      const data = current.data();
      if (data.userId !== tag.userId || data.required || isRequiredTag(current.id)) throw new Error('RESERVED_NAME');
      transaction.update(current.ref, { color: tag.color });
      return { ...data, color: tag.color };
    });
  } catch (error) {
    console.error('Error updating tag:', error);
    throw error;
  }
}
