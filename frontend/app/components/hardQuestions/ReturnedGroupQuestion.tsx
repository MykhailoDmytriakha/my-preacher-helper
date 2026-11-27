"use client";

import { useCallback, useEffect, useState } from 'react';

import { useDataEngine } from '@/data-engine/react.client';
import { useConfirm } from '@/hooks/useConfirm';
import { copyPlainText } from '@/utils/clipboard';
import { useTranslation } from '@locales/useTranslation';

import { SECONDARY_BUTTON } from './parts';

import type { BrowserDataEngine } from '@/data-engine/browser.client';

type Engine = BrowserDataEngine['engine'];
type ReturnedQuestion = Awaited<ReturnType<Engine['listRefusedHardQuestionGroups']>>[number];

function useReturnedWork<T>(load: (engine: Engine) => Promise<T[]>) {
  const { browser, owner } = useDataEngine();
  const [loaded, setLoaded] = useState<{ owner: string; items: T[] } | null>(null);
  useEffect(() => {
    if (!browser || !owner) return;
    let active = true, version = 0;
    const refresh = () => {
      const seen = ++version;
      void load(browser.engine).then(items => {
        if (active && seen === version) setLoaded({ owner, items });
      }, () => undefined);
    };
    const stop = browser.engine.subscribeSavedWork(refresh);
    refresh();
    return () => { active = false; stop(); };
  }, [browser, owner, load]);
  return { browser, owner, items: owner && loaded?.owner === owner ? loaded.items : [] };
}

const listReturnedGroups = (engine: Engine) => engine.listRefusedHardQuestionGroups();

export function ReturnedGroupQuestion({ themeId, questionId }: { themeId?: string; questionId?: string }) {
  const { browser, owner, items: returned } = useReturnedWork(listReturnedGroups);
  const { t } = useTranslation();
  const { confirm, confirmDialog } = useConfirm();
  const [feedback, setFeedback] = useState<{ owner: string; id: string; key: string } | null>(null);
  if (!browser || !owner) return null;
  const items = returned.filter(item => questionId ? item.questionId === questionId : !themeId || item.themeId === themeId);
  if (!items.length) return null;
  const show = (id: string, key: string) => setFeedback({ owner, id, key });
  const discard = async (item: ReturnedQuestion) => {
    if (!await confirm({ title: { key: 'hardQuestions.returnedGroupQuestion.discardTitle' }, confirmText: { key: 'dataSync.discardAction' } })) return;
    try { await browser.engine.discardRefusedHardQuestionGroup(item.id); }
    catch { show(item.id, 'hardQuestions.returnedGroupQuestion.discardFailed'); }
  };
  return (
    <>
      {items.map(item => (
        <section key={item.id} className="my-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          <p className="font-semibold">{t('hardQuestions.returnedGroupQuestion.title')}</p>
          <p className="mt-1 break-words">{item.title}</p>
          <p className="mt-1 break-words">{t('hardQuestions.returnedGroupQuestion.group', { group: item.group })}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={SECONDARY_BUTTON} onClick={() => {
              void copyPlainText([item.title, item.group].join('\n')).then(
                () => show(item.id, 'freshness.copiedToast'),
                () => show(item.id, 'hardQuestions.returnedGroupQuestion.copyFailed'));
            }}>{t('freshness.copyTextAction')}</button>
            <button type="button" className={SECONDARY_BUTTON} onClick={() => { void discard(item); }}>{t('dataSync.discardAction')}</button>
          </div>
          {feedback?.owner === owner && feedback.id === item.id && <p className="mt-2" role="status">{t(feedback.key)}</p>}
        </section>
      ))}
      {confirmDialog}
    </>
  );
}


export function ReturnedHardQuestionOrder({ themeId }: { themeId?: string }) {
  const load = useCallback((engine: Engine) => engine.listRefusedHardQuestionOrders(themeId), [themeId]);
  const { browser, owner, items } = useReturnedWork(load);
  const { t } = useTranslation();
  const [failed, setFailed] = useState<{ owner: string; id: string } | null>(null);
  if (!browser || !owner || !items.length) return null;
  return (
    <>
      {items.map(id => (
        <section key={id} className="my-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          <p className="font-semibold">{t('hardQuestions.returnedOrder.title')}</p>
          <p className="mt-1">{t('hardQuestions.returnedOrder.retryTip')}</p>
          <button type="button" className={'mt-3 ' + SECONDARY_BUTTON} onClick={() => {
            void browser.engine.discardRefusedHardQuestionOrder(id).catch(() => setFailed({ owner, id }));
          }}>{t('hardQuestions.returnedOrder.useSaved')}</button>
          {failed?.id === id && failed.owner === owner
            && <p className="mt-2" role="status">{t('hardQuestions.returnedOrder.discardFailed')}</p>}
        </section>
      ))}
    </>
  );
}
