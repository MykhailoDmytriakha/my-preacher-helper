'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { User } from 'firebase/auth';

interface ReferralCardProps {
  user: User | null;
}

export default function ReferralCard({ user }: ReferralCardProps) {
  const { t } = useTranslation();
  const [referralLink, setReferralLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [invitedCount, setInvitedCount] = useState<number | null>(null);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!user) return;
    setReferralLink(`${window.location.origin}/?ref=${encodeURIComponent(user.uid)}`);
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    setInvitedCount(null);
    if (!user) return () => { cancelled = true; };

    void (async () => {
      try {
        const token = await user.getIdToken();
        const response = await fetch('/api/referral/stats', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) return;
        const body: unknown = await response.json();
        if (
          !cancelled
          && body !== null
          && typeof body === 'object'
          && 'invitedCount' in body
          && typeof body.invitedCount === 'number'
          && Number.isInteger(body.invitedCount)
          && body.invitedCount >= 0
        ) {
          setInvitedCount(body.invitedCount);
        }
      } catch {
        // Referral stats are supplemental; keep the card usable when loading fails.
      }
    })();

    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => () => {
    if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
  }, []);

  if (!user) return null;

  const handleCopy = async () => {
    if (!referralLink) return;
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
      copyResetTimer.current = setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopied(false);
    }
  };

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
          onClick={() => void handleCopy()}
          aria-label={copied ? t('settings.referral.copied') : t('settings.referral.copy')}
          className={`rounded-lg px-4 py-2 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800 ${copied ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-blue-600 hover:bg-blue-700'}`}
        >
          {copied ? t('settings.referral.copied') : t('settings.referral.copy')}
        </button>
      </div>
    </section>
  );
}
