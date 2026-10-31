'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
  changeRelation, dropRelation, nextRelationColor, partEnd, relateWords, relationOn, type AnalysisState, type Relation,
} from '@/utils/passageAnalysis';
import { ANALYSIS_RELATION_TONES } from '@/utils/themeColors';

import { relationArrows, type Geometry } from './analysisGeometry';
import { RelationFlag, RelationMenu } from './RelationParts';

type Said = { text: string; warn: boolean };
/** The open menu: the links it shows (one, or every link of a word pressed) and where it stands. */
type Menu = { keys: string[]; x: number; y: number; word?: number };
/**
 * A link of meaning's arrow while it is pointed at: its path, its heads and its colour; `strong` — its part of the menu is
 * pointed at, and the line is drawn a little bolder, so the link being changed is seen (the owner, 31.10).
 */
export type RelationArrow = { key: string; d: string; heads: string[]; stroke: string; strong: boolean };

const keyOf = (relation: { a: number; b: number }) => `${relation.a}-${relation.b}`;
/** What the menu is kept from the right edge by: it grows with its two words, up to 480 px. */
const MENU_ROOM = 380;

/**
 * THE LINKS OF MEANING OF AN ANALYSIS ON ITS SCREEN (case 2026-10-12-block-diagram, 3.41): the flags at the ends of the
 * lines, the arrow of a link while its flag or one of its words is pointed at, the ring round a linked word — always,
 * the arrow going when the pointer does (the owner, 31.10: «чтобы только связи исчезли, линии, а… обводка… остались»),
 * its menu — from its flag, or from a linked word pressed in «Правка» (31.10: «когда бордер вокруг слова, то ты на него
 * нажимаешь, и тогда ты редактируешь связь») — and a word dropped on a word linking them. The rules are `utils/passageAnalysis.ts`; the editor places what it gets.
 * In «Просмотр» the links show and nothing changes them: a flag pressed only keeps its arrow drawn.
 */
export function useAnalysisRelations({ state, total, geometry, at, bare, editing, showAll = false, change, say }: {
  state: AnalysisState; total: number; geometry: Geometry; at: (x: number, y: number) => { x: number; y: number };
  bare: (word: number) => string; editing: boolean;
  /** Every link's arrow drawn, not only the one pointed at (the switch «Все связи» in «Просмотр»). */
  showAll?: boolean;
  change: (next: AnalysisState, said?: Said | null) => void;
  /** A word in the panel that changes nothing. */
  say: (said: Said) => void;
}) {
  const { t } = useTranslation();
  const [hover, setHover] = useState<string | null>(null);
  const [hoverWord, setHoverWord] = useState<number | null>(null);
  // A flag pressed by a finger, or in «Просмотр»: its arrow stays drawn without a pointer resting on it.
  const [shown, setShown] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const menuKeys = menu?.keys;
  // The link whose part of the menu the pointer is over.
  const [inMenu, setInMenu] = useState<string | null>(null);

  const lit = useMemo(() => {
    const keys = new Set(state.relations.filter((relation) => {
      const key = keyOf(relation);
      return key === hover || key === shown || Boolean(menuKeys?.includes(key)) || relation.a === hoverWord || relation.b === hoverWord;
    }).map(keyOf));
    return (relation: Relation) => keys.has(keyOf(relation));
  }, [hover, hoverWord, menuKeys, shown, state.relations]);

  // The arrows drawn — every link's with «Все связи», else the ones pointed at — routed apart (`relationArrows`).
  const arrows = useMemo((): RelationArrow[] => relationArrows(state, geometry, state.relations.filter((relation) => showAll || lit(relation)), total)
    .map(({ relation, d, heads }) => {
      const key = keyOf(relation);
      return { key, d, heads, stroke: ANALYSIS_RELATION_TONES[relation.color].stroke, strong: key === inMenu && Boolean(menuKeys?.includes(key)) };
    }), [geometry, inMenu, lit, menuKeys, showAll, state, total]);

  const openMenu = (relations: Relation[], point: { x: number; y: number }, word?: number) => {
    setMenu({ keys: relations.map(keyOf), word, x: Math.max(0, Math.min(point.x + 8, geometry.width - MENU_ROOM)), y: point.y + 8 });
    setShown(null);
  };
  /** Under a word: where a menu about it opens. */
  const under = (word: number) => { const box = geometry.words[String(word)]; return box ? { x: box.x, y: box.y + box.h } : { x: 0, y: 0 }; };
  const pressFlag = (relation: Relation, client: { x: number; y: number }, touch: boolean) => {
    const key = keyOf(relation);
    if (!editing || (touch && shown !== key)) { setShown(shown === key && !editing ? null : key); return; }
    openMenu([relation], at(client.x, client.y));
  };

  /** The flags of the links with a word of the line that starts at `start`, each naming the other word. */
  const flagsOf = (start: number): ReactNode => {
    const end = partEnd(state, start, total);
    const here = state.relations.filter((relation) => (relation.a >= start && relation.a < end) || (relation.b >= start && relation.b < end));
    if (!here.length) return null;
    return here.map((relation) => {
      const side = relation.a >= start && relation.a < end ? 'a' : 'b';
      const key = keyOf(relation);
      return (
        <RelationFlag key={key} line={start} relation={relation} here={side} other={bare(side === 'a' ? relation.b : relation.a)} lit={lit(relation)}
          onEnter={() => setHover(key)} onLeave={() => setHover((now) => (now === key ? null : now))}
          onPress={(client, touch) => pressFlag(relation, client, touch)} />
      );
    });
  };

  /** A word dropped on a word: they are linked by meaning — or, linked already, their link's menu opens. */
  const relate = (from: number, to: number | null) => {
    if (to === null) { say({ text: t('analysis.relation.miss'), warn: false }); return; }
    const next = relateWords(state, from, to, total);
    if (next === 'same') { say({ text: t('analysis.relation.miss'), warn: false }); return; }
    if (next === 'has') { openMenu([relationOn(state, from, to)!], under(to)); return; }
    change(next, { text: t('analysis.relation.made', { a: bare(Math.min(from, to)), b: bare(Math.max(from, to)) }), warn: false });
  };

  // The links the menu shows as they stand now: one taken away leaves the rest, the last one the menu.
  const open = menu ? state.relations.filter((relation) => menu.keys.includes(keyOf(relation))) : [];
  const menuNode = open.length && menu && editing ? (
    <RelationMenu x={menu.x} y={menu.y}
      label={open.length === 1 ? t('analysis.relation.menu', { a: bare(open[0].a), b: bare(open[0].b) }) : t('analysis.relation.menuWord', { word: bare(menu.word ?? open[0].a) })}
      items={open.map((relation) => ({
        relation, a: bare(relation.a), b: bare(relation.b),
        onEnter: () => setInMenu(keyOf(relation)),
        onLeave: () => setInMenu((now) => (now === keyOf(relation) ? null : now)),
        onDir: (dir) => change(changeRelation(state, relation.a, relation.b, { dir }, total)),
        onColor: (color) => change(changeRelation(state, relation.a, relation.b, { color }, total)),
        onDrop: () => {
          if (open.length === 1) setMenu(null);
          setHover(null);
          change(dropRelation(state, relation.a, relation.b, total), { text: t('analysis.relation.dropped', { a: bare(relation.a), b: bare(relation.b) }), warn: false });
        },
      }))} />
  ) : null;

  /** The line from a word being dragged to the pointer, in the colour its link of meaning will get. */
  const dragLine = (drag: { from: number; x: number; y: number } | null): ReactNode => {
    const from = drag ? geometry.words[String(drag.from)] : undefined;
    if (!drag || !from) return null;
    return (
      <svg aria-hidden="true" width={geometry.width || 1} height={geometry.height || 1} className={`pointer-events-none absolute left-0 top-0 overflow-visible ${ANALYSIS_RELATION_TONES[nextRelationColor(state)].stroke}`}>
        <path d={`M ${Math.round(from.x + from.w / 2)} ${Math.round(from.y + from.h / 2)} L ${drag.x} ${drag.y}`} fill="none" strokeWidth={2} strokeDasharray="5 4" strokeLinecap="round" />
      </svg>
    );
  };

  return {
    arrows, flagsOf, relate, menuNode, dragLine,
    /** The ring round a linked word, always: in the colour of its link pointed at, else of its first link. */
    ringOf: (word: number) => {
      const own = state.relations.filter((relation) => relation.a === word || relation.b === word);
      const found = own.find(lit) ?? own[0];
      return found ? ANALYSIS_RELATION_TONES[found.color].ring : undefined;
    },
    /** A word pressed in «Правка»: a linked one opens the menu of its links; any other lets an open menu go. */
    pressWord: (word: number) => {
      const own = state.relations.filter((relation) => relation.a === word || relation.b === word);
      if (!editing || !own.length) { setMenu(null); return; }
      openMenu(own, under(word), word);
    },
    linked: (word: number) => state.relations.some((relation) => relation.a === word || relation.b === word),
    pointWord: setHoverWord,
    /** Escape or a press elsewhere: the menu and a kept arrow go. True when there was one. */
    letGo: () => { const had = menu !== null || shown !== null; setMenu(null); setShown(null); return had; },
  };
}
