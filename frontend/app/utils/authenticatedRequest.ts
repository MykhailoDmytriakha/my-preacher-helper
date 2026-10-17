import { APP_LANGUAGE_HEADER, browserInterfaceLanguage } from '@/utils/appLocale';

/** The interface's language, said to the server when this browser knows it (`appLocale.ts`). */
export function interfaceLanguageHeaders(): Record<string, string> {
  const language = browserInterfaceLanguage();
  return language ? { [APP_LANGUAGE_HEADER]: language } : {};
}

/**
 * Who the request comes from and the language they write in: the current browser user's Firebase
 * bearer header when available, and the interface's language — the server reads a note's old
 * references in the author's Bible by it.
 */
export async function getAuthenticatedRequestHeaders(): Promise<Record<string, string>> {
  if (typeof window === 'undefined') return {};

  const { auth } = await import('@/services/firebaseAuth.service');
  const token = await auth.currentUser?.getIdToken();
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...interfaceLanguageHeaders() };
}
