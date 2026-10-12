/**
 * Whether this device still holds a session: Firebase's own persistence key
 * (`firebase:authUser:<apiKey>:<name>`, browserLocalPersistence) or a guest profile. Checked against
 * Firebase's key rather than a mirror of our own, so a persisted session is never taken for a sign-out
 * during the moment before onAuthStateChanged has answered.
 */
export function hasPersistedSession(): boolean {
  try {
    return Boolean(localStorage.getItem('guestUser')) || Object.keys(localStorage).some(key => key.startsWith('firebase:authUser:'));
  } catch {
    return false;
  }
}
