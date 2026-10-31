'use client';

import { ChevronDownIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { RELATION_COLORS, RELATION_DIRS, relationSign, type Relation, type RelationColor, type RelationDir } from '@/utils/passageAnalysis';
import { ANALYSIS_RELATION_TONES } from '@/utils/themeColors';

/*
 * A LINK OF MEANING ON THE SCREEN (case 2026-10-12-block-diagram, 3.41; the owner's choice on the canvas, «Флажки у
 * строки», 2026-10-30): at rest no line runs across the text — at the end of each line a flag in the link's colour
 * names the other word, «→ исповедует». The arrow is drawn while the flag or one of its words is pointed at; the flag
 * pressed opens the link's menu: the two words with the way between them as a dropdown of four, its colour, remove.
 */

const DIR_LABEL: Record<RelationDir, string> = {
  fwd: 'analysis.relation.dirs.fwd', back: 'analysis.relation.dirs.back', both: 'analysis.relation.dirs.both', none: 'analysis.relation.dirs.none',
};
const COLOR_LABEL: Record<RelationColor, string> = {
  amber: 'analysis.relation.colors.amber', teal: 'analysis.relation.colors.teal', pink: 'analysis.relation.colors.pink',
  sky: 'analysis.relation.colors.sky', lime: 'analysis.relation.colors.lime', violet: 'analysis.relation.colors.violet',
};

/**
 * A flag at the end of a line: a link of meaning with a word of this line, named by the other word. `touch` — pressed by
 * a finger: with no pointer to rest on it, the first press shows the arrow and the second opens the menu.
 */
export function RelationFlag({ line, relation, here, other, lit, onEnter, onLeave, onPress }: {
  line: number; relation: Relation; here: 'a' | 'b'; other: string; lit: boolean;
  onEnter: () => void; onLeave: () => void; onPress: (at: { x: number; y: number }, touch: boolean) => void;
}) {
  const { t } = useTranslation();
  const tone = ANALYSIS_RELATION_TONES[relation.color];
  const [touch, setTouch] = useState(false);
  return (
    <button type="button" data-flag="" data-flagline={line} aria-label={t('analysis.relation.flag', { word: other })}
      onPointerDown={(event) => setTouch(event.pointerType === 'touch')}
      onMouseEnter={onEnter} onMouseLeave={onLeave}
      onClick={(event) => { event.stopPropagation(); onPress({ x: event.clientX, y: event.clientY }, touch); }}
      className={`ml-2 inline-flex h-5 items-center gap-1 whitespace-nowrap rounded border-l-[3px] px-1.5 align-[3px] font-sans text-[11px] font-semibold leading-none ${tone.edge} ${tone.text} ${lit ? tone.tint : 'bg-gray-50 dark:bg-gray-900'}`}>
      <span aria-hidden="true">{relationSign(relation, here)}</span>{other}
    </button>
  );
}

/** The flag as the side panel shows it: the same look, standing at the start of a line of text. */
export function RelationGlyph() {
  return (
    <span aria-hidden="true" className={`mr-1.5 inline-flex h-[18px] items-center rounded border-l-[3px] bg-gray-50 px-1.5 align-[-3px] font-sans text-[11px] font-semibold dark:bg-gray-900 ${ANALYSIS_RELATION_TONES.amber.edge} ${ANALYSIS_RELATION_TONES.amber.text}`}>
      →
    </span>
  );
}

/** One link in the menu: its two words, and what changes it. */
export type RelationMenuItem = {
  relation: Relation; a: string; b: string;
  onDir: (dir: RelationDir) => void; onColor: (color: RelationColor) => void; onDrop: () => void;
  /** The pointer, or the keyboard's focus, came onto this link's part of the menu, or left it: its line is drawn bolder. */
  onEnter?: () => void; onLeave?: () => void;
};

/**
 * A link's menu (the owner, 2026-10-30: «два слова и посередине стрелочка… всего четыре варианта… дропдаун, раз выбрал
 * и всё»): «a» [→ ▾] «b», the colours, «Убрать связь». The two words stand whole — the menu grows with them («текст
 * должен помещаться», 30.10). A word pressed that has several links shows them all, one under another (the owner,
 * 31.10: «нажимаешь на это слово, и… открывается вот эта панелька, которая редактирует связи»).
 */
export function RelationMenu({ items, label, x, y }: { items: RelationMenuItem[]; label: string; x: number; y: number }) {
  return (
    <div data-relation-menu="" role="dialog" aria-label={label}
      onClick={(event) => event.stopPropagation()}
      className="absolute z-40 flex w-max min-w-[272px] max-w-[480px] flex-col gap-1 rounded-xl border border-gray-200 bg-white p-2.5 font-sans shadow-xl dark:border-gray-700 dark:bg-gray-900"
      style={{ left: x, top: y }}>
      {items.map((item, k) => <RelationControls key={`${item.relation.a}-${item.relation.b}`} item={item} divided={k > 0} />)}
    </div>
  );
}

function RelationControls({ item, divided }: { item: RelationMenuItem; divided: boolean }) {
  const { t } = useTranslation();
  const { relation, a, b, onDir, onColor, onDrop, onEnter, onLeave } = item;
  const [open, setOpen] = useState(false);
  const tone = ANALYSIS_RELATION_TONES[relation.color];
  return (
    <div data-relation-item={`${relation.a}-${relation.b}`} onMouseEnter={onEnter} onMouseLeave={onLeave} onFocus={onEnter}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onLeave?.(); }} className={`flex flex-col gap-1 ${divided ? 'mt-1 border-t border-gray-200 pt-2.5 dark:border-gray-700' : ''}`}>
      <div className="flex items-center gap-1.5 px-0.5 pb-2 text-sm font-semibold">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${tone.swatch}`} aria-hidden="true" />
        <span className="whitespace-nowrap">«{a}»</span>
        <span className="relative shrink-0">
          <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={t('analysis.relation.dir')} onClick={() => setOpen(!open)}
            className="inline-flex h-7 items-center gap-1 rounded-lg border border-gray-300 px-2 text-[15px] font-bold hover:border-gray-500 dark:border-gray-600 dark:hover:border-gray-400">
            {relationSign(relation, 'a')}<ChevronDownIcon className="h-3 w-3 text-gray-400" strokeWidth={2.4} aria-hidden="true" />
          </button>
          {open ? (
            <span role="listbox" aria-label={t('analysis.relation.dir')}
              className="absolute left-1/2 top-8 z-10 flex w-44 -translate-x-1/2 flex-col gap-0.5 rounded-lg border border-gray-200 bg-white p-1.5 shadow-lg dark:border-gray-700 dark:bg-gray-950">
              {RELATION_DIRS.map((dir) => (
                <button key={dir} type="button" role="option" aria-selected={relation.dir === dir} onClick={() => { onDir(dir); setOpen(false); }}
                  className={`flex h-[30px] items-center gap-2 rounded-md px-2 text-left text-[13px] font-semibold hover:bg-gray-100 dark:hover:bg-gray-800 ${relation.dir === dir ? 'bg-gray-100 dark:bg-gray-800' : ''}`}>
                  <span className="w-[18px] text-center text-[15px]" aria-hidden="true">{relationSign({ ...relation, dir }, 'a')}</span>{t(DIR_LABEL[dir])}
                </button>
              ))}
            </span>
          ) : null}
        </span>
        <span className="whitespace-nowrap">«{b}»</span>
      </div>
      <div className="flex gap-2 px-0.5 pb-2" role="group" aria-label={t('analysis.relation.color')}>
        {RELATION_COLORS.map((color) => (
          <button key={color} type="button" aria-label={t(COLOR_LABEL[color])} aria-pressed={relation.color === color} onClick={() => onColor(color)}
            className={`h-[22px] w-[22px] rounded-full ${ANALYSIS_RELATION_TONES[color].swatch} ${relation.color === color ? 'ring-2 ring-gray-900 ring-offset-2 ring-offset-white dark:ring-white dark:ring-offset-gray-900' : ''}`} />
        ))}
      </div>
      <button type="button" onClick={onDrop}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-left text-sm font-semibold text-rose-600 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/50">
        <XMarkIcon className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />{t('analysis.relation.drop')}
      </button>
    </div>
  );
}
