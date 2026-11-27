'use client';

import { XMarkIcon } from '@heroicons/react/24/outline';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import TextareaAutosize from 'react-textarea-autosize';

import FormDialog, { FormActions, FormButton } from '@/components/ui/FormDialog';
import { FORM_INPUT_CLASS } from '@/components/ui/FormField';
import Select from '@/components/ui/Select';
import { useDiscardQuestion } from '@/hooks/useConfirm';
import { groupNamed } from '@/utils/hardQuestions';
import { useTranslation } from '@locales/useTranslation';


import type { NewQuestion } from '@/hooks/useHardQuestions';
import type { HardQuestion, HardQuestionGroup, HardQuestionTheme } from '@/models/models';
import type { HardQuestionLibrary } from '@/utils/hardQuestions';

const NONE = '';
/** The group list's «+ Новая группа…»: a value no group id takes (ids are client ids). */
const NEW_GROUP = '+new-group';
const labelClass = 'text-sm font-semibold text-gray-800 dark:text-gray-200';

/** The themes a picker lists: the library's, and the theme the page shows if the list has not read it yet. */
function pickerThemes(library: HardQuestionLibrary, currentTheme?: HardQuestionTheme | null): HardQuestionTheme[] {
  const themes = library.themes.map((view) => view.theme);
  if (currentTheme && !themes.some((theme) => theme.id === currentTheme.id)) themes.push(currentTheme);
  return themes;
}

/** A new group being named in a picker: its words, or `null` while a group is chosen from the list. */
type NewGroupField = { title: string | null; onTitle: (title: string | null) => void };

/**
 * Theme and group pickers. The group list appears for a theme that has groups — or for any theme when a new group
 * may be named here (`newGroup`): the list's last entry, «+ Новая группа…», turns it into a field for the name, and
 * «×» returns to the list (the owner, 2026-11-26: a group is made where the question that needs it is written).
 */
function PlacePicker({ themes, themeId, groupId, onTheme, onGroup, idPrefix, newGroup }: {
  themes: readonly HardQuestionTheme[]; themeId: string; groupId: string; onTheme: (id: string) => void; onGroup: (id: string) => void; idPrefix: string;
  newGroup?: NewGroupField;
}) {
  const { t } = useTranslation();
  const backToList = useRef(false);
  const groups = themes.find((theme) => theme.id === themeId)?.groups ?? [];
  const naming = newGroup && newGroup.title !== null ? newGroup : null;
  const same = naming ? groupNamed(groups, naming.title ?? '') : undefined;
  let groupField: ReactNode = null;
  if (themeId && naming) {
    groupField = (
      <div>
        <label className={labelClass} htmlFor={`${idPrefix}-new-group`}>{t('hardQuestions.dialogs.group')}</label>
        <div className="mt-2 flex items-center gap-1">
          <input id={`${idPrefix}-new-group`} autoFocus value={naming.title ?? ''} onChange={(event) => naming.onTitle(event.target.value)}
            placeholder={t('hardQuestions.dialogs.newGroupPlaceholder')} aria-describedby={same ? `${idPrefix}-new-group-same` : undefined}
            className={`${FORM_INPUT_CLASS} min-w-0 flex-1`} />
          <button type="button" onClick={() => { backToList.current = true; naming.onTitle(null); }}
            aria-label={t('hardQuestions.dialogs.backToGroups')} title={t('hardQuestions.dialogs.backToGroups')}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100">
            <XMarkIcon className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        {same && (
          <p id={`${idPrefix}-new-group-same`} className="mt-1.5 text-xs text-gray-600 dark:text-gray-400">
            {t('hardQuestions.dialogs.groupExistsJoin', { title: same.title })}
          </p>
        )}
      </div>
    );
  } else if (themeId && (groups.length > 0 || newGroup)) {
    groupField = (
      <label className="block" htmlFor={`${idPrefix}-group`}>
        <span className={labelClass}>{t('hardQuestions.dialogs.group')}</span>
        {/* Back from naming a group, the list takes the focus the closed field had. */}
        <Select id={`${idPrefix}-group`} value={groupId} size="lg" accent="blue" wrapperClassName="mt-2"
          ref={(element) => { if (element && backToList.current) { backToList.current = false; element.focus(); } }}
          onChange={(event) => {
            if (event.target.value !== NEW_GROUP) { onGroup(event.target.value); return; }
            onGroup(NONE);
            newGroup?.onTitle('');
          }}>
          <option value={NONE}>{t('hardQuestions.withoutGroup')}</option>
          {groups.map((group) => <option key={group.id} value={group.id}>{group.title}</option>)}
          {newGroup && <option value={NEW_GROUP}>{t('hardQuestions.dialogs.newGroupOption')}</option>}
        </Select>
      </label>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="block" htmlFor={`${idPrefix}-theme`}>
        <span className={labelClass}>{t('hardQuestions.dialogs.theme')}</span>
        <Select id={`${idPrefix}-theme`} value={themeId} size="lg" accent="blue" wrapperClassName="mt-2"
          onChange={(event) => { onTheme(event.target.value); onGroup(NONE); newGroup?.onTitle(null); }}>
          <option value={NONE}>{t('hardQuestions.withoutTheme')}</option>
          {themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.title}</option>)}
        </Select>
      </label>
      {groupField}
    </div>
  );
}

/** Where a new question goes: the group chosen, the group named (or the one the theme has under that name), or none. */
function placeOfNew(themes: readonly HardQuestionTheme[], themeId: string, groupId: string, newGroupTitle: string | null):
  Pick<NewQuestion, 'themeId' | 'groupId' | 'newGroupTitle'> {
  if (!themeId) return {};
  if (newGroupTitle === null) return { themeId, groupId: groupId || undefined };
  const same = groupNamed(themes.find((theme) => theme.id === themeId)?.groups, newGroupTitle);
  return same ? { themeId, groupId: same.id } : { themeId, newGroupTitle };
}

/**
 * «Спросили — записал»: the words as they were asked, and where the question belongs — a theme and a group of it,
 * or a group named right here. Written down to be answered later (it waits on the section's first page), or opened
 * at once to answer.
 */
export function NewQuestionDialog({ library, initialText = '', initialThemeId = NONE, initialGroupId = NONE, currentTheme = null, onClose, onCreate }: {
  library: HardQuestionLibrary; initialText?: string; initialThemeId?: string; initialGroupId?: string; currentTheme?: HardQuestionTheme | null; onClose: () => void;
  onCreate: (input: NewQuestion, then: 'later' | 'answer') => Promise<void>;
}) {
  const { t } = useTranslation();
  const themes = pickerThemes(library, currentTheme);
  const [title, setTitle] = useState(initialText);
  const [themeId, setThemeId] = useState(library.themeById.has(initialThemeId) || currentTheme?.id === initialThemeId ? initialThemeId : NONE);
  const [groupId, setGroupId] = useState(initialGroupId);
  const [newGroupTitle, setNewGroupTitle] = useState<string | null>(null);
  const [saving, setSaving] = useState<'later' | 'answer' | null>(null);
  // «Отмена» asks before it drops what was typed, as the window's «×» does (`FormActions` asks the same way).
  const { askBeforeDiscard, discardDialog } = useDiscardQuestion();
  const unsaved = title.trim() !== initialText.trim() || Boolean(newGroupTitle?.trim());
  // «+ Новая группа…» chosen and left unnamed: the question waits for the name rather than go without a group.
  const unnamedGroup = Boolean(themeId) && newGroupTitle !== null && !newGroupTitle.trim();
  const blocked = saving !== null || !title.trim() || unnamedGroup;
  const run = async (then: 'later' | 'answer') => {
    if (blocked) return;
    setSaving(then);
    try {
      await onCreate({ title, ...placeOfNew(themes, themeId, groupId, newGroupTitle) }, then);
    } finally {
      setSaving(null);
    }
  };
  return (
    <FormDialog title={t('hardQuestions.dialogs.newQuestion')} tone="rose" size="form" onClose={onClose} closeDisabled={saving !== null}
      unsaved={unsaved} showCloseButton
      onSubmit={(event: FormEvent) => { event.preventDefault(); void run('later'); }}
      footer={(
        <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
          <FormButton variant="secondary" onClick={() => { void askBeforeDiscard(unsaved, onClose); }} disabled={saving !== null}>{t('common.cancel')}</FormButton>
          {discardDialog}
          <FormButton variant="secondary" disabled={blocked} onClick={() => void run('answer')}>
            {saving === 'answer' ? t('common.saving') : t('hardQuestions.dialogs.writeAndAnswer')}
          </FormButton>
          <FormButton type="submit" tone="rose" disabled={blocked} aria-busy={saving === 'later'}>
            {saving === 'later' ? t('common.saving') : t('hardQuestions.dialogs.writeForLater')}
          </FormButton>
        </div>
      )}>
      {/* Frozen while it is being kept: words typed after the press would close with the window, unkept. */}
      <fieldset disabled={saving !== null} className="flex min-w-0 flex-col gap-5">
        <div>
          <label className={labelClass} htmlFor="hq-new-question">{t('hardQuestions.dialogs.asked')}</label>
          <TextareaAutosize id="hq-new-question" autoFocus value={title} onChange={(event) => setTitle(event.target.value)} minRows={2} maxRows={6}
            aria-describedby="hq-new-question-hint" placeholder={t('hardQuestions.dialogs.askedPlaceholder')} className={`${FORM_INPUT_CLASS} mt-2`} />
          <p id="hq-new-question-hint" className="mt-1.5 text-xs text-gray-600 dark:text-gray-400">{t('hardQuestions.dialogs.askedHint')}</p>
        </div>
        <PlacePicker themes={themes} themeId={themeId} groupId={groupId} onTheme={setThemeId} onGroup={setGroupId} idPrefix="hq-new"
          newGroup={{ title: newGroupTitle, onTitle: setNewGroupTitle }} />
      </fieldset>
    </FormDialog>
  );
}

/** A new theme: its title and, if the pastor wants, its opening words. */
export function NewThemeDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (input: { title: string; intro?: string }) => Promise<void> }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [intro, setIntro] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !title.trim()) return;
    setSaving(true);
    try { await onCreate({ title, intro }); } finally { setSaving(false); }
  };
  return (
    <FormDialog title={t('hardQuestions.dialogs.newTheme')} tone="rose" size="form" onClose={onClose} closeDisabled={saving}
      unsaved={Boolean(title.trim() || intro.trim())} showCloseButton onSubmit={submit}
      footer={<FormActions tone="rose" onCancel={onClose} cancelLabel={t('common.cancel')} submitLabel={t('hardQuestions.dialogs.createTheme')}
        saving={saving} cancelDisabled={saving} submitDisabled={!title.trim()} unsaved={Boolean(title.trim() || intro.trim())} />}>
      <fieldset disabled={saving} className="flex min-w-0 flex-col gap-5">
        <label className="block" htmlFor="hq-theme-title">
          <span className={labelClass}>{t('hardQuestions.dialogs.themeTitle')}</span>
          <input id="hq-theme-title" autoFocus value={title} onChange={(event) => setTitle(event.target.value)}
            placeholder={t('hardQuestions.dialogs.themeTitlePlaceholder')} className={`${FORM_INPUT_CLASS} mt-2`} />
        </label>
        <div>
          <label className={labelClass} htmlFor="hq-theme-intro">{t('hardQuestions.dialogs.intro')}</label>
          <TextareaAutosize id="hq-theme-intro" value={intro} onChange={(event) => setIntro(event.target.value)} minRows={3} maxRows={10}
            aria-describedby="hq-theme-intro-hint" className={`${FORM_INPUT_CLASS} mt-2`} />
          <p id="hq-theme-intro-hint" className="mt-1.5 text-xs text-gray-600 dark:text-gray-400">{t('hardQuestions.dialogs.introHint')}</p>
        </div>
      </fieldset>
    </FormDialog>
  );
}

/**
 * A group's title — a new group, or a group renamed (`groupId`). A theme keeps one group per name, so a name another
 * of its `groups` already has is said under the field and not saved (`groupNamed`).
 */
export function GroupDialog({ initialTitle = '', groupId, groups = [], onClose, onSave }: {
  initialTitle?: string; groupId?: string; groups?: readonly HardQuestionGroup[]; onClose: () => void; onSave: (title: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(initialTitle);
  const [saving, setSaving] = useState(false);
  const taken = groupNamed(groups, title, groupId);
  const changed = title.trim() !== initialTitle.trim();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !title.trim() || !changed || taken) return;
    setSaving(true);
    try { await onSave(title); } finally { setSaving(false); }
  };
  return (
    <FormDialog title={initialTitle ? t('hardQuestions.dialogs.renameGroup') : t('hardQuestions.dialogs.newGroup')} tone="rose" size="compact"
      onClose={onClose} closeDisabled={saving} unsaved={changed} showCloseButton onSubmit={submit}
      footer={<FormActions tone="rose" onCancel={onClose} cancelLabel={t('common.cancel')} submitLabel={t('common.save')}
        saving={saving} cancelDisabled={saving} submitDisabled={!title.trim() || !changed || Boolean(taken)} unsaved={changed} />}>
      <label className="block" htmlFor="hq-group-title">
        <span className={labelClass}>{t('hardQuestions.dialogs.groupTitle')}</span>
        <input id="hq-group-title" autoFocus value={title} disabled={saving} onChange={(event) => setTitle(event.target.value)}
          aria-describedby={taken ? 'hq-group-taken' : undefined}
          placeholder={t('hardQuestions.dialogs.groupTitlePlaceholder')} className={`${FORM_INPUT_CLASS} mt-2`} />
      </label>
      {taken && (
        <p id="hq-group-taken" className="mt-1.5 text-xs text-gray-600 dark:text-gray-400">{t('hardQuestions.dialogs.groupTaken', { title: taken.title })}</p>
      )}
    </FormDialog>
  );
}

/** Puts a question into another theme or group; the bases of a theme it leaves are that theme's own. */
export function MoveQuestionDialog({ library, question, onClose, onMove }: {
  library: HardQuestionLibrary; question: HardQuestion; onClose: () => void; onMove: (themeId: string | undefined, groupId: string | undefined) => Promise<void>;
}) {
  const { t } = useTranslation();
  const startTheme = question.themeId && library.themeById.has(question.themeId) ? question.themeId : NONE;
  const [themeId, setThemeId] = useState(startTheme);
  const [groupId, setGroupId] = useState(question.groupId ?? NONE);
  const [saving, setSaving] = useState(false);
  const leavesBases = themeId !== startTheme && (question.basisIds ?? []).length > 0;
  const unchanged = themeId === startTheme && groupId === (question.groupId ?? NONE);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || unchanged) return;
    setSaving(true);
    try { await onMove(themeId || undefined, groupId || undefined); } finally { setSaving(false); }
  };
  return (
    <FormDialog title={t('hardQuestions.dialogs.moveQuestion')} tone="rose" size="form" onClose={onClose} closeDisabled={saving} showCloseButton onSubmit={submit}
      footer={<FormActions tone="rose" onCancel={onClose} cancelLabel={t('common.cancel')} submitLabel={t('hardQuestions.dialogs.move')}
        saving={saving} cancelDisabled={saving} submitDisabled={unchanged} />}>
      <fieldset disabled={saving} className="flex min-w-0 flex-col gap-4">
        <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">{question.title}</p>
        <PlacePicker themes={pickerThemes(library)} themeId={themeId} groupId={groupId} onTheme={setThemeId} onGroup={setGroupId} idPrefix="hq-move" />
        {leavesBases && <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-400">{t('hardQuestions.dialogs.leavesBases')}</p>}
      </fieldset>
    </FormDialog>
  );
}
