'use client';

import { AlignLeft, ArrowRight, BookOpen, ListPlus, LoaderCircle, RotateCcw, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TextareaAutosize from 'react-textarea-autosize';

import { NOTE_PLAN_INSTRUCTION_LIMIT, type NotePlanRevisionIntent } from '@/utils/notePlan';
import { PLAN_REFINEMENT_COLORS as colors } from '@/utils/themeColors';

export const refinementPanelId = (id: string) => `plan-refinement-${id}`;

const presets = [
  { key: 'references', mode: 'references', Icon: BookOpen },
  { key: 'more', mode: 'edit', Icon: ListPlus },
  { key: 'shorter', mode: 'edit', Icon: AlignLeft },
  { key: 'rewrite', mode: 'rewrite', Icon: RotateCcw },
] as const;

export default function NotePlanRefinement({ id, open, scope, busy, disabled, onClose, onGenerate }: {
  id: string; open: boolean; scope: string; busy: boolean; disabled: boolean;
  onClose: () => void; onGenerate: (intent: NotePlanRevisionIntent) => void;
}) {
  const { t } = useTranslation();
  const [instruction, setInstruction] = useState('');
  const [mode, setMode] = useState<NotePlanRevisionIntent['mode']>('edit');
  const [selected, setSelected] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  const panelId = refinementPanelId(id);
  const submit = () => {
    if (!disabled && !busy && instruction.trim()) onGenerate({ instruction: instruction.trim(), mode });
  };
  if (!open) return null;
  return (
    <section id={panelId} aria-labelledby={`${panelId}-title`}
      className={`rounded-xl border p-3 sm:p-4 ${colors.panel}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submit(); }
      }}>
      <div className="mb-3 flex items-start gap-2.5">
        <Sparkles aria-hidden="true" className={`mt-1 h-5 w-5 shrink-0 ${colors.icon}`} />
        <div className="min-w-0 flex-1">
          <h5 id={`${panelId}-title`} className={`text-base font-semibold ${colors.heading}`}>{t('plan.refine.title')}</h5>
          <p className={`mt-0.5 break-words text-xs ${colors.muted}`}>{scope}</p>
        </div>
        <button type="button" aria-label={t('common.close')} onClick={onClose}
          className={`-mr-1 -mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${colors.close}`}>
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
      <TextareaAutosize ref={input} minRows={3} maxLength={NOTE_PLAN_INSTRUCTION_LIMIT}
        aria-label={t('plan.refine.title')} aria-describedby={`${panelId}-hint`}
        value={instruction} disabled={busy}
        onChange={(event) => {
          setInstruction(event.target.value);
          if (mode === 'edit') setSelected('');
        }}
        placeholder={t('plan.refine.placeholder')}
        className={`block w-full resize-none overflow-hidden rounded-lg border px-3 py-2.5 text-sm leading-relaxed outline-none transition-shadow focus:ring-2 disabled:opacity-60 ${colors.field}`} />
      <div className="mt-2 flex flex-wrap gap-1.5" aria-label={t('plan.refine.quickRequests')}>
        {presets.map(({ key, mode: nextMode, Icon }) => (
          <button key={key} type="button" disabled={busy} aria-pressed={selected === key}
            onClick={() => {
              if (selected === key) { setSelected(''); setMode('edit'); }
              else { setSelected(key); setMode(nextMode); setInstruction(t(`plan.refine.requests.${key}`)); }
              input.current?.focus();
            }}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50 ${selected === key ? colors.selected : colors.chip}`}>
            <Icon aria-hidden="true" className="h-3.5 w-3.5" />{t(`plan.refine.presets.${key}`)}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p id={`${panelId}-hint`} className={`max-w-md text-xs leading-relaxed ${colors.muted}`}>
          {t(mode === 'references' ? 'plan.refine.referencesHint' : 'plan.refine.reviewHint')}
        </p>
        <button type="button" onClick={submit} disabled={disabled || busy || !instruction.trim()}
          className={`inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 ${colors.primary}`}>
          {busy ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
          {t(busy ? 'plan.refine.working' : 'plan.refine.submit')}
          {!busy && <ArrowRight aria-hidden="true" className="h-4 w-4" />}
        </button>
      </div>
    </section>
  );
}
