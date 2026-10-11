'use client';

import { useQuery } from '@tanstack/react-query';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useClipboard } from '@/hooks/useClipboard';
import { apiClient } from '@/utils/apiClient';

import type { User } from 'firebase/auth';

interface ReferralCardProps {
  user: User | null;
}

export default function ReferralCard({ user }: ReferralCardProps) {
  const { t } = useTranslation();
  const [referralLink, setReferralLink] = useState('');
  const { isCopied: copied, copyToClipboard, reset } = useClipboard({ successDuration: 2000 });
  /**
   * How many people this person brought — a React Query entry, so the number last seen is saved with
   * the cache and shown without a network (owner's decision 2026-10-10), and the request reports its
   * outcome like every other one (`apiClient`). Supplemental: a failure keeps the card usable.
   */
  const { data: invitedCount = null } = useQuery({
    queryKey: ['referral-stats', user?.uid],
    enabled: Boolean(user),
    // A failure throws rather than answering null, so the number already seen stays on screen and in
    // the saved copy instead of being replaced by nothing.
    queryFn: async (): Promise<number> => {
      const token = await user!.getIdToken();
      const response = await apiClient('/api/referral/stats', {
        category: 'metadata',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(`Referral stats: ${response.status}`);
      const body: unknown = await response.json();
      if (
        body !== null
        && typeof body === 'object'
        && 'invitedCount' in body
        && typeof body.invitedCount === 'number'
        && Number.isInteger(body.invitedCount)
        && body.invitedCount >= 0
      ) return body.invitedCount;
      throw new Error('Referral stats: unexpected answer');
    },
  });

  useEffect(() => {
    reset();
    if (!user) return;
    setReferralLink(`${window.location.origin}/?ref=${encodeURIComponent(user.uid)}`);
  }, [user, reset]);

  if (!user) return null;

  return (
    <section className="rounded-[14px] bg-white p-4 shadow-sm dark:bg-slate-800 md:p-6" aria-labelledby="referral-card-title">
      <h2 id="referral-card-title" className="text-lg font-semibold text-gray-900 dark:text-white">
        {t('settings.referral.title')}
      </h2>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        {t('settings.referral.description')}
      </p>
      <p className="mt-4 flex items-center gap-2.5 rounded-xl bg-emerald-50 px-3.5 py-3 text-sm font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
        <span aria-hidden="true">🎁</span>
        {t('settings.referral.reward')}
        {invitedCount !== null && (
          <span className="ml-auto whitespace-nowrap">
            {t('settings.referral.invitedCount', { count: invitedCount })}
          </span>
        )}
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={referralLink}
          readOnly
          aria-label={t('settings.referral.linkLabel')}
          className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-900/50 dark:text-slate-100"
        />
        <button
          type="button"
          onClick={() => void copyToClipboard(referralLink)}
          aria-label={copied ? t('settings.referral.copied') : t('settings.referral.copy')}
          className={`rounded-lg px-4 py-2 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800 ${copied ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-blue-600 hover:bg-blue-700'}`}
        >
          {copied ? t('settings.referral.copied') : t('settings.referral.copy')}
        </button>
      </div>
    </section>
  );
}
