'use client';

import { useEffect, useState } from 'react';

import UnreadableDraftCopies from '@/components/UnreadableDraftCopies';
import { findUnreadableNoteDraftCopies } from '@/utils/newNoteDrafts';

import type { LegacyRecoverySource } from '@/data-engine/legacyRecovery.client';

/** Invalid metadata never blocks reading the authored words or keeping the original bytes. */
export default function UnreadableNoteDrafts({ owner, documentId }: { owner: string | null | undefined; documentId?: string }) {
  const [state, setState] = useState<{ owner: string; documentId?: string; copies: LegacyRecoverySource[]; failed: boolean } | null>(null);
  useEffect(() => {
    if (!owner) return;
    const refresh = () => {
      try { setState({ owner, documentId, copies: findUnreadableNoteDraftCopies(owner, documentId), failed: false }); }
      catch { setState(previous => ({ owner, documentId, copies: previous?.owner === owner && previous.documentId === documentId ? previous.copies : [], failed: true })); }
    };
    refresh();
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    return () => { window.removeEventListener('storage', refresh); window.removeEventListener('focus', refresh); };
  }, [owner, documentId]);
  if (!owner || state?.owner !== owner || state.documentId !== documentId) return null;
  const copies = state.copies.map(source => {
    const value = (source.payload as { value?: unknown }).value;
    const fields = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    return { source, title: typeof fields.title === 'string' ? fields.title : '', content: typeof fields.content === 'string' ? fields.content : '' };
  });
  return <UnreadableDraftCopies owner={owner} copies={copies} failed={state.failed} />;
}
