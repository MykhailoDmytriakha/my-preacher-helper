import { adminDb } from "app/config/firebaseAdminConfig";
import { Tag } from "@/models/models";

export async function getRequiredTags() {
  const requiredTagIds = ["intro", "main", "conclusion"];
  try {
    const tagPromises = requiredTagIds.map(async (tagId) => {
      const docRef = adminDb.collection("tags").doc(tagId);
      const docSnap = await docRef.get();
      if (docSnap.exists) {
        return { id: docSnap.id, ...docSnap.data() };
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
      
    const customTags = querySnapshot.docs.map((doc) => doc.data());
    return customTags as Tag[];
  } catch (error) {
    console.error(`Error fetching custom tags for user ${userId}:`, error);
    throw error;
  }
}

export async function saveTag(tag: Tag) {
  try {
    const tagsRef = adminDb.collection("tags");
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


