const BEARER_PREFIX = 'Bearer ';

export interface AuthenticatedIdentity {
  uid: string;
  email: string | undefined;
  emailVerified: boolean;
}

/** Returns identity claims from one verified Firebase token decode. */
export async function getAuthenticatedIdentity(
  request: Request
): Promise<AuthenticatedIdentity | null> {
  const authorization = request.headers?.get('authorization');
  if (!authorization?.startsWith(BEARER_PREFIX)) return null;

  const token = authorization.slice(BEARER_PREFIX.length).trim();
  if (!token) return null;

  try {
    const { adminAuth } = await import('@/config/firebaseAdminConfig');
    const decoded = await adminAuth.verifyIdToken(token);
    if (!decoded.uid) return null;

    return {
      uid: decoded.uid,
      email: typeof decoded.email === 'string' ? decoded.email : undefined,
      emailVerified: decoded.email_verified === true,
    };
  } catch {
    return null;
  }
}
