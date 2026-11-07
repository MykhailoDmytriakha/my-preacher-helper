import { replaceEqualDeep } from '@tanstack/react-query';

import { preferSavedAccountRead } from '@/utils/accountReadCache';
import { accountReadValue, keepCurrentAccountRead, type AccountRead } from '@/utils/accountReadVersion';

export function accountReadHttpFailure(status: number, message: string): Error {
  // A temporary backend failure still permits the last successful offline answer.
  return Object.assign(new Error(message), { status, ...(status === 429 || status >= 500 ? { code: 'unavailable' } : {}) });
}

export function accountReadQuery<T>(queryKey: readonly unknown[], read: () => Promise<AccountRead<T>>) {
  return {
    queryKey,
    queryFn: async () => preferSavedAccountRead(queryKey, await read()),
    select: accountReadValue<T>,
    structuralSharing: (current: unknown, next: unknown) => keepCurrentAccountRead(current, next) ? current : replaceEqualDeep(current, next),
  };
}
