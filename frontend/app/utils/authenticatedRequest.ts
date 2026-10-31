import { APP_LANGUAGE_HEADER, browserInterfaceLanguage } from '@/utils/appLocale';
import { resolveOwnerUid } from '@/utils/queryKeys';

const ACCOUNT_CHANGED = 'Account changed';

/**
 * THE ANSWER TO A REQUEST THAT OUTLIVED ITS ACCOUNT.
 *
 * A sign-in that lands while a token is fetched or an answer is in the air must not hand one
 * account's documents to another. Seven places built this refusal by hand; it is one value now,
 * so a caller can also recognise it (`isAccountChangedError`) instead of matching the message.
 */
export function accountChangedError(): Error {
  return Object.assign(new Error(ACCOUNT_CHANGED), { code: 'unauthenticated' });
}

export function isAccountChangedError(error: unknown): boolean {
  return error instanceof Error && error.message === ACCOUNT_CHANGED;
}

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
export async function getAuthenticatedRequestHeaders(expectedOwnerUid: string | null = resolveOwnerUid() ?? null): Promise<Record<string, string>> {
  if (typeof window === 'undefined') return {};

  const { auth } = await import('@/services/firebaseAuth.service');
  const user = auth.currentUser;
  // Bind the credential before its asynchronous lookup: an A → B → A cycle can otherwise
  // return B's token while an outer check once again observes A.
  if ((user?.uid ?? null) !== expectedOwnerUid) throw accountChangedError();
  const token = await user?.getIdToken();
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...interfaceLanguageHeaders() };
}
