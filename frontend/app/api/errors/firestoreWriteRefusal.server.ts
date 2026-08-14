const FIRESTORE_REFUSAL_BY_GRPC_CODE: Record<number, { code: string; status: number }> = {
  3: { code: 'invalid-argument', status: 400 },
  5: { code: 'not-found', status: 404 },
  6: { code: 'already-exists', status: 409 },
  7: { code: 'permission-denied', status: 403 },
  9: { code: 'failed-precondition', status: 412 },
  11: { code: 'out-of-range', status: 400 },
  12: { code: 'unimplemented', status: 501 },
  16: { code: 'unauthenticated', status: 401 },
};

const FIRESTORE_REFUSAL_STATUS_BY_NAME: Record<string, number> = {
  'invalid-argument': 400,
  'not-found': 404,
  'already-exists': 409,
  'permission-denied': 403,
  'failed-precondition': 412,
  'out-of-range': 400,
  'unimplemented': 501,
  'unauthenticated': 401,
};

/** Preserve Admin SDK / gRPC write refusals across an HTTP boundary. */
export function resolveFirestoreWriteRefusal(
  error: unknown
): { code: string; status: number } | null {
  const rawCode = (error as { code?: unknown } | null)?.code;
  if (typeof rawCode === 'number') {
    return FIRESTORE_REFUSAL_BY_GRPC_CODE[rawCode] ?? null;
  }
  if (typeof rawCode !== 'string') return null;

  const numericCode = Number(rawCode);
  if (Number.isInteger(numericCode) && FIRESTORE_REFUSAL_BY_GRPC_CODE[numericCode]) {
    return FIRESTORE_REFUSAL_BY_GRPC_CODE[numericCode];
  }

  const normalized = rawCode
    .replace(/^firestore\//i, '')
    .replace(/_/g, '-')
    .toLowerCase();
  const status = FIRESTORE_REFUSAL_STATUS_BY_NAME[normalized];
  return status ? { code: normalized, status } : null;
}
