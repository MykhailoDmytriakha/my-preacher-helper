'use client';

import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { MineBadge } from '@/components/bible/MineBadge';
import { saveMinePrefs, useMinePrefs, type CommentsShown } from '@/components/bible/minePrefs';
import { USAGE_KIND_LOOK } from '@/components/bible/usageKinds';
import { ChoiceButtons, SettingRow } from '@/components/settings/SettingRow';
import Switch from '@/components/ui/Switch';
import { SCRIPTURE_USAGE_KINDS } from '@/utils/scriptureUsage';

/**
 * SETTINGS → BIBLE: THE PERSON'S OWN MATERIAL ON THE TEXT (case 2026-10-12-block-diagram, 2.2). What it is
 * is said in words a person who knows no code reads (the owner, 2026-10-20), and the four badges are shown
 * as the reader draws them, in their colours, so the colour of each kind is learnt here once.
 */
export default function MineSettings() {
  const { t } = useTranslation();
  const prefs = useMinePrefs();
  const id = useId();
  const commentLooks: { value: CommentsShown; label: string }[] = [
    { value: 'text', label: t('settings.bible.mine.commentsText') },
    { value: 'badge', label: t('settings.bible.mine.commentsBadge') },
  ];
  return (
    <section aria-labelledby={`${id}-title`} className="rounded-lg bg-white shadow dark:bg-gray-800" data-testid="mine-settings">
      <div className="space-y-3 border-b border-gray-200 p-4 dark:border-gray-700 md:px-6">
        <h2 id={`${id}-title`} className="text-lg font-semibold text-gray-900 dark:text-white md:text-xl">{t('settings.bible.mine.title')}</h2>
        <p className="text-sm text-gray-700 dark:text-gray-300">{t('settings.bible.mine.intro')}</p>
        {/* The words above say what it is; the badges only show it. */}
        <div aria-hidden="true" className="flex flex-wrap gap-2">
          {SCRIPTURE_USAGE_KINDS.map((kind) => <MineBadge key={kind} kind={kind} label={t(USAGE_KIND_LOOK[kind].wordKey)} />)}
        </div>
      </div>
      <SettingRow title={t('settings.bible.mine.show')} hint={t('settings.bible.mine.showHint')}>
        {(ids) => (
          <Switch checked={prefs.show} aria-labelledby={ids.name} aria-describedby={ids.hint} onClick={() => saveMinePrefs({ show: !prefs.show })} data-testid="mine-settings-switch" />
        )}
      </SettingRow>
      {/* A comment as grey words under its verse or chapter heading, or a badge like the rest (the owner, 2026-10-28). */}
      <div className={prefs.show ? '' : 'opacity-50'}>
        <SettingRow below title={t('settings.bible.mine.comments')} hint={t('settings.bible.mine.commentsHint')}>
          {(ids) => <ChoiceButtons ids={ids} choices={commentLooks} value={prefs.comments} disabled={!prefs.show} onPick={(comments) => saveMinePrefs({ comments })} />}
        </SettingRow>
      </div>
    </section>
  );
}
