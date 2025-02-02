import { db } from "app/config/firebaseConfig";
import { doc, getDoc } from "firebase/firestore";

export async function fetchSermonById(id: string) {
  // Create a reference to the document in the "sermons" collection using the provided id.
  const docRef = doc(db, "sermons", id);

  // Fetch the document snapshot
  const docSnap = await getDoc(docRef);

  if (!docSnap.exists()) {
    console.error(`Sermon with id ${id} not found in Firestore`);
    throw new Error("Sermon not found");
  }

  // Combine the document id with its data.
  const sermon = { id: docSnap.id, ...docSnap.data() };
  console.log("Sermon retrieved:", sermon);
  return sermon;
}