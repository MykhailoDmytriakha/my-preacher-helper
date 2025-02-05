import { db } from "app/config/firebaseConfig";
import { doc, getDoc, deleteDoc } from "firebase/firestore";
import { log } from "@utils/logger";

export async function fetchSermonById(id: string) {
  // Create a reference to the document in the "sermons" collection using the provided id.
  const docRef = doc(db, "sermons", id);
  log.info(`Firestore: fetching sermon ${id}`);

  // Fetch the document snapshot
  const docSnap = await getDoc(docRef);

  if (!docSnap.exists()) {
    console.error(`Sermon with id ${id} not found in Firestore`);
    throw new Error("Sermon not found");
  }

  // Combine the document id with its data.
  const sermon = { id: docSnap.id, ...docSnap.data() };
  log.info("Sermon retrieved:", sermon);
  return sermon;
}

export async function deleteSermonById(id: string): Promise<void> {
  log.info(`Firestore: deleting sermon ${id}`);
  const docRef = doc(db, "sermons", id);
  await deleteDoc(docRef);
  log.info(`Firestore: deleted sermon ${id}`);
}
