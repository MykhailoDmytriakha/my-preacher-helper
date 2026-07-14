const BEARER_PREFIX = 'Bearer ';

/** Returns the verified Firebase caller UID, or null for any missing/invalid credential. */
export async function getRequiredAuthenticatedUid(request: Request): Promise<string | null> {
  const authorization = request.headers?.get('authorization');
  if (!authorization?.startsWith(BEARER_PREFIX)) return null;

  const token = authorization.slice(BEARER_PREFIX.length).trim();
  if (!token) return null;

  try {
    const { adminAuth } = await import('@/config/firebaseAdminConfig');
    const decoded = await adminAuth.verifyIdToken(token);
    return decoded.uid || null;
  } catch {
    return null;
  }
}
