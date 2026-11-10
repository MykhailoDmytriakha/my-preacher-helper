// Leave room for Firestore's native representation and engine metadata written alongside these proofs.
const documentProofCeiling = 960 * 1024;

export function documentProofHeadroom(value: object, metadata: object | undefined): number {
  return documentProofCeiling - Buffer.byteLength(JSON.stringify({ ...value, _dataEngine: metadata }));
}
