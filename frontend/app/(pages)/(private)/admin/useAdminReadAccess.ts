import { useCallback, useEffect, useRef, useState } from 'react';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { auth } from '@/services/firebaseAuth.service';
import { apiClient } from '@/utils/apiClient';
import { isConnectionFailure } from '@/utils/connectionFailure';
import { isKnownOffline } from '@/utils/connectivity';

import { keepAdminRead, readAdminCopy, revokeAdminCopy, type AdminReadCopy, type AdminReadData } from './adminOfflineRead';

type Grant = { fence: string | null };

type Access = 'checking' | 'authorized' | 'unauthorized' | 'offline' | 'unavailable';

export const isAdminDenial = (status: number): boolean => status === 401 || status === 403;

export async function adminToken(owner: string): Promise<string> {
  const user = auth.currentUser;
  if (!user || user.uid !== owner) throw new Error('Admin account changed');
  const token = await user.getIdToken();
  if (auth.currentUser?.uid !== owner) throw new Error('Admin account changed');
  return token;
}

export function useAdminReadAccess(owner: string) {
  const online = useOnlineStatus();
  const [access, setAccess] = useState<Access>('checking');
  const [copy, setCopy] = useState<AdminReadCopy>();
  const [attempt, setAttempt] = useState(0);
  const wasOnline = useRef(online);
  const [grant, setGrant] = useState<Grant>();
  const activeGrant = useRef<Grant | undefined>(undefined);
  const denied = useRef(false);

  useEffect(() => () => { activeGrant.current = undefined; }, []);

  const recheck = useCallback(() => {
    activeGrant.current = undefined;
    setGrant(undefined);
    setAccess('checking');
    setAttempt(previous => previous + 1);
  }, []);

  useEffect(() => {
    if (online && !wasOnline.current) recheck();
    wasOnline.current = online;
  }, [online, recheck]);

  const refuse = useCallback(() => {
    denied.current = true;
    activeGrant.current = undefined;
    setGrant(undefined);
    setCopy(undefined);
    setAccess('unauthorized');
    void revokeAdminCopy(owner);
  }, [owner]);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const current = () => !signal.aborted && auth.currentUser?.uid === owner;
    const stored = readAdminCopy(owner);

    void stored.then(saved => {
      if (current() && !denied.current && isKnownOffline()) {
        setCopy(saved);
        setAccess('offline');
      }
    });

    void (async () => {
      let result: Access;
      try {
        const token = await adminToken(owner);
        const response = await apiClient('/api/admin/me', {
          category: 'metadata', signal, headers: { Authorization: `Bearer ${token}` },
        });
        if (isAdminDenial(response.status)) result = 'unauthorized';
        else if (!response.ok) result = 'unavailable';
        else {
          const data: unknown = await response.json();
          const allowed = data && typeof data === 'object' && 'admin' in data ? data.admin : undefined;
          result = allowed === true ? 'authorized' : allowed === false ? 'unauthorized' : 'unavailable';
        }
      } catch (error) {
        result = isConnectionFailure(error) ? 'offline' : 'unavailable';
      }
      if (!current()) return;
      if (result === 'unauthorized') {
        refuse();
        return;
      }
      const saved = await stored;
      if (!current()) return;
      if (result === 'authorized') {
        denied.current = false;
        const accepted = { fence: saved?.fence ?? null };
        activeGrant.current = accepted;
        setGrant(accepted);
      }
      setCopy(denied.current ? undefined : saved);
      setAccess(denied.current ? 'unauthorized' : result);
    })();

    return () => controller.abort();
  }, [attempt, owner, refuse]);

  const isCurrent = useCallback(() =>
    Boolean(grant) && activeGrant.current === grant && auth.currentUser?.uid === owner, [grant, owner]);
  const keep = useCallback(async (change: (previous: AdminReadCopy | undefined) => AdminReadData) => {
    if (!grant || !isCurrent()) return false;
    const saved = await keepAdminRead(owner, grant.fence, change);
    if (!isCurrent()) return false;
    if (saved.kind === 'stale') {
      recheck();
      return false;
    }
    setCopy(previous => saved.kind === 'kept' ? saved.copy : { ...previous, owner, fence: grant.fence, ...change(previous) });
    return true;
  }, [grant, isCurrent, owner, recheck]);

  return { access, copy, isCurrent, keep, refuse, recheck, readOnly: access === 'offline' || (access === 'authorized' && !online) };
}
