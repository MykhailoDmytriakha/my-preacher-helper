import { db } from "app/config/firebaseConfig";
import { doc, getDoc, deleteDoc, collection, query, where, getDocs, addDoc } from "firebase/firestore";
import { Tag } from "@/models/models";
import { log } from "@utils/logger";
import { Sermon } from "@/models/models";

export async function fetchSermonById(id: string) {
  const docRef = doc(db, "sermons", id);
  log.info(`Firestore: fetching sermon ${id}`);
  const docSnap = await getDoc(docRef);

  if (!docSnap.exists()) {
    console.error(`Sermon with id ${id} not found in Firestore`);
    throw new Error("Sermon not found");
  }
  const sermon = { id: docSnap.id, ...docSnap.data() } as Sermon;
  log.info(`Sermon retrieved: with id ${sermon.id} and title ${sermon.title}`);
  return sermon;

}

export async function deleteSermonById(id: string): Promise<void> {
  log.info(`Firestore: deleting sermon ${id}`);
  const docRef = doc(db, "sermons", id);
  await deleteDoc(docRef);
  log.info(`Firestore: deleted sermon ${id}`);
}

export async function getRequiredTags() {
  const tagsCollection = collection(db, "tags");
  const queryForSearch = query(tagsCollection, where("required", "==", true));
  const querySnapshot = await getDocs(queryForSearch);
  const requiredTags = querySnapshot.docs.map((doc) => doc.data());
  return requiredTags;
}


export async function getCustomTags(userId: string) {
  const tagsCollection = collection(db, "tags");
  const queryForSearch = query(tagsCollection, where("required", "==", false), where("userId", "==", userId));
  const querySnapshot = await getDocs(queryForSearch);
  const customTags = querySnapshot.docs.map((doc) => doc.data());
  return customTags as Tag[];
}

export async function saveTag(tag: Tag) {
  const tagsCollection = collection(db, "tags");
  const queryForSearch = query(tagsCollection, where("name", "==", tag.name), where("userId", "==", tag.userId));
  const querySnapshot = await getDocs(queryForSearch);
  if (querySnapshot.docs.length > 0) {
    throw new Error("Tag with same name and userId already exists");
  }
  await addDoc(tagsCollection, tag);
}

export async function deleteTag(userId: string, tagName: string) {
  log.info(`Firestore: deleting tag ${tagName} for user ${userId}`);
  const tagsCollection = collection(db, "tags");
  const queryForSearch = query(tagsCollection, where("userId", "==", userId), where("name", "==", tagName));
  const querySnapshot = await getDocs(queryForSearch);
  if (querySnapshot.docs.length === 0) {
    throw new Error("Tag not found");
  }
  const docRef = doc(tagsCollection, querySnapshot.docs[0].id);
  await deleteDoc(docRef);
  log.info(`Firestore: deleted tag ${tagName} for user ${userId}`);
}


