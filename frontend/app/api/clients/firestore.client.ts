import { adminDb } from "app/config/firebaseAdminConfig";
import { Tag } from "@/models/models";

// Define the mapping of required tag IDs to their translation keys
export const REQUIRED_TAG_TRANSLATIONS = {
  // Standard lowercase versions
  "intro": "tags.introduction",
  "main": "tags.mainPart",
  "conclusion": "tags.conclusion",
  
  // Capitalized versions
  "Intro": "tags.introduction",
  "Main": "tags.mainPart",
  "Conclusion": "tags.conclusion",
  
  // Russian versions
  "Вступление": "tags.introduction",
  "Основная часть": "tags.mainPart", 
  "Заключение": "tags.conclusion"
};

// Standard required tag IDs (lowercase canonical versions)
export const REQUIRED_TAG_IDS = ["intro", "main", "conclusion"];

// Helper function to check if a tag name is a required tag
export function isRequiredTag(tagName: string): boolean {
  return tagName in REQUIRED_TAG_TRANSLATIONS;
}

// Get translation key for a tag name if it's a required tag
export function getTranslationKeyForTag(tagName: string): string | undefined {
  return REQUIRED_TAG_TRANSLATIONS[tagName as keyof typeof REQUIRED_TAG_TRANSLATIONS];
}

export async function getRequiredTags() {
  try {
    const tagPromises = REQUIRED_TAG_IDS.map(async (tagId) => {
      const docRef = adminDb.collection("tags").doc(tagId);
      const docSnap = await docRef.get();
      if (docSnap.exists) {
        // Add translationKey to the tag object
        return { 
          id: docSnap.id, 
          ...docSnap.data(),
          translationKey: getTranslationKeyForTag(tagId)
        };
      }
      return null;
    });
    
    const tags = await Promise.all(tagPromises);
    return tags.filter((tag): tag is NonNullable<typeof tag> => tag !== null) as Tag[];
  } catch (error) {
    console.error("Error fetching required tags:", error);
    throw error;
  }
}

export async function getCustomTags(userId: string) {
  try {
    const tagsRef = adminDb.collection("tags");
    const querySnapshot = await tagsRef
      .where("required", "==", false)
      .where("userId", "==", userId)
      .get();
      
    const customTags = querySnapshot.docs.map((doc) => {
      const data = doc.data();
      const tagId = doc.id;
      const tagName = data.name;
      
      // Check if this custom tag matches any of the required tag variations
      if (isRequiredTag(tagId) || (tagName && isRequiredTag(tagName))) {
        return {
          ...data,
          id: tagId,
          translationKey: getTranslationKeyForTag(tagId) || (tagName && getTranslationKeyForTag(tagName))
        };
      }
      
      return { ...data, id: tagId };
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
      const updated = thoughts.map((th: any) => ({
        ...th,
        tags: Array.isArray(th.tags) ? th.tags.filter((t: string) => t !== tagName) : []
      }));
      // Count diffs
      thoughts.forEach((th: any, idx: number) => {
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


