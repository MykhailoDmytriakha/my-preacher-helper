'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { useDocumentActions } from '@/data-engine/react.client';
import { useTranslation } from '@locales/useTranslation';

export function ServiceOrderDraftLinks({ visibleIds }: { visibleIds: readonly string[] }) {
  const { t } = useTranslation();
  const actions = useDocumentActions();
  const [found, setFound] = useState<{ owner: string; links: { id: string; title?: string }[] } | null>(null);
  useEffect(() => {
    const { owner, ready } = actions;
    if (!ready || !owner) return;
    let active = true;
    const refresh = () => {
      void actions.listServiceOrderDraftLinks().then(links => {
        if (active) setFound({ owner, links });
      }).catch(() => undefined);
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => { active = false; window.removeEventListener('focus', refresh); };
  }, [actions]);
  const links = found && found.owner === actions.owner ? found.links.filter(link => !visibleIds.includes(link.id)) : [];
  if (!links.length) return null;
  return <section aria-label={t('serviceOrders.recoveryDrafts')} className="mt-6 space-y-2 rounded-xl border border-gray-200 p-4 dark:border-gray-700">
    <h2 className="font-semibold">{t('serviceOrders.recoveryDrafts')}</h2>
    <ul className="space-y-2">
      {links.map(({ id, title }) => <li key={id}><Link href={`/care/orders/${encodeURIComponent(id)}`}
        className="text-sm font-semibold text-emerald-700 underline dark:text-emerald-300">{title || t('serviceOrders.reviewDraftLink')}</Link></li>)}
    </ul>
  </section>;
}
