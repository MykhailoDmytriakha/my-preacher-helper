import { adminDb } from "@/config/firebaseAdminConfig";
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
    // Check if tag already exists
    const querySnapshot = await tagsRef
      .where("name", "==", tag.name)
      .where("userId", "==", tag.userId)
      .get();
      
    if (!querySnapshot.empty) {
      throw new Error("Tag with same name and userId already exists");
    }
    
    await tagsRef.add(tag);
  } catch (error) {
    console.error("Error saving tag:", error);
    throw error;
  }
}

export async function deleteTag(userId: string, tagName: string) {
  console.log(`Firestore: deleting tag ${tagName} for user ${userId}`);
  try {
    const tagsRef = adminDb.collection("tags");
    const querySnapshot = await tagsRef
      .where("userId", "==", userId)
      .where("name", "==", tagName)
      .get();
      
    if (querySnapshot.empty) {
      throw new Error("Tag not found");
    }
    
    await tagsRef.doc(querySnapshot.docs[0].id).delete();
    console.log(`Firestore: deleted tag ${tagName} for user ${userId}`);
    // Cascade: remove tag from all thoughts in all user's sermons
    const sermonsSnap = await adminDb.collection("sermons").where("userId", "==", userId).get();
    let affectedThoughts = 0;
    const batch = adminDb.batch();
    sermonsSnap.forEach((doc) => {
      const data = doc.data();
      const thoughts = Array.isArray(data.thoughts) ? data.thoughts : [];
      const updated = thoughts.map((th: Record<string, unknown>) => ({
        ...th,
        tags: Array.isArray(th.tags) ? th.tags.filter((t: string) => t !== tagName) : []
      }));
      // Count diffs
      thoughts.forEach((th: Record<string, unknown>, idx: number) => {
        const before = Array.isArray(th.tags) ? th.tags.length : 0;
        const after = Array.isArray(updated[idx].tags) ? updated[idx].tags.length : 0;
        if (after < before) affectedThoughts += (before - after);
      });
      if (JSON.stringify(updated) !== JSON.stringify(thoughts)) {
        batch.update(doc.ref, { thoughts: updated });
      }
    });
    if (!sermonsSnap.empty) {
      await batch.commit();
    }
    return { affectedThoughts };
  } catch (error) {
    console.error(`Error deleting tag ${tagName} for user ${userId}:`, error);
    throw error;
  }
}

export async function updateTagInDb(tag: Tag) {
  try {
    const tagsRef = adminDb.collection('tags');
    let querySnapshot;
    
    if (tag.required) {
      querySnapshot = await tagsRef
        .where('required', '==', true)
        .where('name', '==', tag.name)
        .get();
    } else {
      querySnapshot = await tagsRef
        .where('userId', '==', tag.userId)
        .where('name', '==', tag.name)
        .get();
    }
    
    if (querySnapshot.empty) {
      console.error('updateTagInDb: No matching tag found for tag', tag);
      throw new Error('Tag not found');
    }
    
    const tagDoc = querySnapshot.docs[0];
    console.log('updateTagInDb: Found tag doc', tagDoc.id, tagDoc.data());
    
    await tagsRef.doc(tagDoc.id).update({ color: tag.color });
    
    const updatedDoc = await tagsRef.doc(tagDoc.id).get();
    console.log('updateTagInDb: Updated tag doc', updatedDoc.data());
    return updatedDoc.data();
  } catch (error) {
    console.error('Error updating tag:', error);
    throw error;
  }
}
