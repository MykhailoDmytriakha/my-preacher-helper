/** Returns the current browser user's Firebase bearer header when available. */
export async function getAuthenticatedRequestHeaders(): Promise<Record<string, string>> {
  if (typeof window === 'undefined') return {};

  const { auth } = await import('@/services/firebaseAuth.service');
  const token = await auth.currentUser?.getIdToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
