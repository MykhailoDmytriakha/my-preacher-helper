
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
