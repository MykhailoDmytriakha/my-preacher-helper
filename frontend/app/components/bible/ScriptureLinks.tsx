'use client';

import { createContext, useContext, useMemo, type MouseEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { resolveAppLocale, type AppLocale } from '@/utils/appLocale';
import { referencesInText, type ReferenceInText } from '@/utils/bibleLink';

import type { SheetReference } from './verseSheetGeometry';
import type { Element, ElementContent, Root, RootContent, Text } from 'hast';

/**
 * A REFERENCE IN TEXT IS A LINK — "Прочитайте Рим 12:1–2", "Быт. 6:13", "1 Фес. 1:9-10" in a block's
 * text, a plan, a question — drawn as the sermon's verse is drawn, and pressed where it stands. A
 * screen says only what a press does: open the text over it (a meeting, a sermon being preached) or
 * go to the Bible (a page being prepared). Text with no `ScriptureLinks` around it stays as it was,
 * so a note, a shared page or a PDF is untouched.
 */

/** The one look of a reference to open: the sermon's verse, every reference in text. */
export const SCRIPTURE_LINK_CLASSES =
  'rounded font-semibold text-indigo-700 underline decoration-indigo-300 underline-offset-4 transition hover:decoration-indigo-600 dark:text-indigo-300 dark:decoration-indigo-500/60 dark:hover:decoration-indigo-300';

type ScriptureLinksValue = { locale: AppLocale; onOpen: (reference: SheetReference) => void };

const ScriptureLinksContext = createContext<ScriptureLinksValue | null>(null);

/** References in the text inside are links; `onOpen` gets the one pressed, its words as `label`. */
export function ScriptureLinks({ onOpen, children }: { onOpen: (reference: SheetReference) => void; children: ReactNode }) {
  const { i18n } = useTranslation();
  // Typed as the person reads: in the Bible of the interface's language.
  const locale = resolveAppLocale(i18n?.language);
  const value = useMemo(() => ({ locale, onOpen }), [locale, onOpen]);
  return <ScriptureLinksContext.Provider value={value}>{children}</ScriptureLinksContext.Provider>;
}

/**
 * Inside, references stay text again — for what leaves the screen as a document: a PDF drawn
 * under a page that links its references.
 */
export function WithoutScriptureLinks({ children }: { children: ReactNode }) {
  return <ScriptureLinksContext.Provider value={null}>{children}</ScriptureLinksContext.Provider>;
}

/** The mark every reference link carries: a copy of the page turns it back into its words. */
export const SCRIPTURE_LINK_MARK = 'data-scripture-link';

/** The screen's way of opening a reference, or null where references stay text. */
export function useScriptureLinks(): ScriptureLinksValue | null {
  return useContext(ScriptureLinksContext);
}

function ScriptureLink({ found, children }: { found: Pick<ReferenceInText, 'raw' | 'reference'>; children: ReactNode }) {
  const links = useScriptureLinks();
  if (!links) return <>{children}</>;
  const open = (event: MouseEvent) => {
    // The text may sit in something pressable — a block row selects its block: the press is the link's.
    event.stopPropagation();
    links.onOpen({ ...found.reference, label: found.raw });
  };
  return (
    <button type="button" onClick={open} className={SCRIPTURE_LINK_CLASSES} {...{ [SCRIPTURE_LINK_MARK]: '' }}>
      {children}
    </button>
  );
}

/** Plain text — a question, a leader's note — with its references as links. */
export function ScriptureText({ text }: { text: string }) {
  const links = useScriptureLinks();
  const found = useMemo(() => (links ? referencesInText(text, links.locale) : []), [text, links]);
  if (found.length === 0) return <>{text}</>;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const each of found) {
    if (each.start > at) parts.push(text.slice(at, each.start));
    parts.push(<ScriptureLink key={each.start} found={each}>{each.raw}</ScriptureLink>);
    at = each.end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

/** The element a found reference becomes in rendered Markdown, before React draws it. */
export const SCRIPTURE_LINK_TAG = 'scripture-link';

/** Where references are not looked for: links, code, and anything already pressable. */
const LEFT_AS_WRITTEN = new Set(['a', 'code', 'pre', 'button', SCRIPTURE_LINK_TAG]);

function linkedText(value: string, locale: AppLocale): Array<Text | Element> {
  const found = referencesInText(value, locale);
  if (found.length === 0) return [{ type: 'text', value }];
  const parts: Array<Text | Element> = [];
  let at = 0;
  for (const { start, end, raw, reference } of found) {
    if (start > at) parts.push({ type: 'text', value: value.slice(at, start) });
    parts.push({
      type: 'element',
      tagName: SCRIPTURE_LINK_TAG,
      properties: { dataReference: JSON.stringify({ raw, reference }) },
      children: [{ type: 'text', value: raw }],
    });
    at = end;
  }
  if (at < value.length) parts.push({ type: 'text', value: value.slice(at) });
  return parts;
}

function linkChildren(parent: Root | Element, locale: AppLocale): void {
  const next: Array<RootContent | ElementContent> = [];
  for (const child of parent.children) {
    if (child.type === 'text') {
      next.push(...linkedText(child.value, locale));
      continue;
    }
    if (child.type === 'element' && !LEFT_AS_WRITTEN.has(child.tagName)) linkChildren(child, locale);
    next.push(child);
  }
  parent.children = next as typeof parent.children;
}

/**
 * The Markdown side: a rehype plugin that turns the references in rendered text into
 * `SCRIPTURE_LINK_TAG` elements, drawn by `MarkdownScriptureLink`. Runs after sanitizing, so only
 * the app makes these elements, never the text.
 */
export function rehypeScriptureLinks(locale: AppLocale) {
  return (tree: Root) => linkChildren(tree, locale);
}

/** Draws a `SCRIPTURE_LINK_TAG` element of rendered Markdown. */
export function MarkdownScriptureLink({ children, ...props }: { children?: ReactNode; 'data-reference'?: string }) {
  const data = props['data-reference'];
  const found = useMemo(() => {
    try {
      return JSON.parse(data ?? '') as Pick<ReferenceInText, 'raw' | 'reference'>;
    } catch {
      return null;
    }
  }, [data]);
  return found ? <ScriptureLink found={found}>{children}</ScriptureLink> : <>{children}</>;
}
