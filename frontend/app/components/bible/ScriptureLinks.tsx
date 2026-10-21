'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type MouseEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Chip } from '@/components/ui/Chip';
import { resolveAppLocale, type AppLocale } from '@/utils/appLocale';
import { referencesInText, type ReferenceInText } from '@/utils/bibleLink';

import type { SheetReference } from './verseSheetGeometry';
import type { BibleId } from '@/utils/bibles';
import type { Element, ElementContent, Root, RootContent, Text } from 'hast';

/**
 * A REFERENCE IN TEXT IS A LINK — "Прочитайте Рим 12:1–2", "Быт. 6:13", "1 Фес. 1:9-10" in a block's
 * text, a plan, a question — drawn as the sermon's verse is drawn, and pressed where it stands. A
 * screen says only what a press does; every screen opens the text over it — a meeting, a sermon being
 * preached with their own window, a page being prepared through `ScriptureLinksInWindow` (`VerseWindow.tsx`),
 * whose window offers the Bible page. Text with no `ScriptureLinks` around it stays as it was, so a
 * note, a shared page or a PDF is untouched.
 */

/** The one look of a reference to open: the sermon's verse, every reference in text. */
export const SCRIPTURE_LINK_CLASSES =
  'rounded font-semibold text-indigo-700 underline decoration-indigo-300 underline-offset-4 transition hover:decoration-indigo-600 dark:text-indigo-300 dark:decoration-indigo-500/60 dark:hover:decoration-indigo-300';

type ScriptureLinksValue = { locale: AppLocale; written: AppLocale | null; onOpen: (reference: SheetReference) => void };

const ScriptureLinksContext = createContext<ScriptureLinksValue | null>(null);

/**
 * References in the text inside are links; `onOpen` gets the one pressed, its words as `label`. Each is
 * read in the Bible it was written in (`bibleLink.ts` → `writtenLanguage`): `writtenIn` is the language
 * of the document they belong to (`utils/documentLanguage.ts`) — its words decide a book Russian and
 * Ukrainian write alike, before the words of one text in it.
 */
export function ScriptureLinks({ onOpen, writtenIn = null, children }: { onOpen: (reference: SheetReference) => void; writtenIn?: AppLocale | null; children: ReactNode }) {
  const { i18n } = useTranslation();
  const locale = resolveAppLocale(i18n?.language);
  // The press goes to the latest `onOpen`, but the text inside is not drawn again for a new one: a screen's
  // way to the Bible changes with its address, and the list of notes changes its address on every letter searched.
  const openRef = useRef(onOpen);
  useEffect(() => { openRef.current = onOpen; }, [onOpen]);
  const open = useCallback((reference: SheetReference) => openRef.current(reference), []);
  const value = useMemo(() => ({ locale, written: writtenIn, onOpen: open }), [locale, writtenIn, open]);
  return <ScriptureLinksContext.Provider value={value}>{children}</ScriptureLinksContext.Provider>;
}

/** The language of one document among others inside `ScriptureLinks` — a note on the list of notes, its title and words. */
export function ScriptureWrittenIn({ language, children }: { language: AppLocale | null; children: ReactNode }) {
  const links = useScriptureLinks();
  const value = useMemo(() => (links ? { ...links, written: language ?? links.written } : null), [links, language]);
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

/** The mark every Bible mark beside a reference carries: a copy of the page leaves it out. */
export const SCRIPTURE_BIBLE_MARK = 'data-scripture-bible';

/**
 * The Bible a reference was written in, beside it, where the reader would take its letters elsewhere:
 * a Synodal "Пс 22:1" under an English interface is the Shepherd's psalm, Ps 23:1 (the owner,
 * 2026-10-20, the case canvas row 2.2.1: "the reference's translation"; `writtenInFor`). Not copied
 * with the text.
 */
export function WrittenInMark({ bible }: { bible: BibleId }) {
  const { t } = useTranslation();
  return (
    <span className="ml-1 select-none align-middle" {...{ [SCRIPTURE_BIBLE_MARK]: '' }}>
      <Chip tone="amber" size="xs" weight="bold" title={t('bible.writtenIn', { translation: t(`bible.translations.${bible}.name`) })}>
        {t(`bible.translations.${bible}.short`)}
      </Chip>
    </span>
  );
}

function ScriptureLink({ found, children }: { found: Pick<ReferenceInText, 'raw' | 'reference' | 'writtenIn'>; children: ReactNode }) {
  const links = useScriptureLinks();
  if (!links) return <>{children}</>;
  const open = (event: MouseEvent) => {
    // The text may sit in something pressable — a block row selects its block: the press is the link's.
    event.stopPropagation();
    links.onOpen({ ...found.reference, label: found.raw });
  };
  return (
    <>
      <button type="button" onClick={open} className={SCRIPTURE_LINK_CLASSES} {...{ [SCRIPTURE_LINK_MARK]: '' }}>
        {children}
      </button>
      {found.writtenIn ? <WrittenInMark bible={found.writtenIn} /> : null}
    </>
  );
}

/** Plain text — a question, a leader's note — with its references as links. */
export function ScriptureText({ text }: { text: string }) {
  const links = useScriptureLinks();
  const found = useMemo(() => (links ? referencesInText(text, links.locale, links.written) : []), [text, links]);
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

function linkedText(value: string, locale: AppLocale, written: AppLocale | null): Array<Text | Element> {
  const found = referencesInText(value, locale, written);
  if (found.length === 0) return [{ type: 'text', value }];
  const parts: Array<Text | Element> = [];
  let at = 0;
  for (const { start, end, raw, reference, writtenIn } of found) {
    if (start > at) parts.push({ type: 'text', value: value.slice(at, start) });
    parts.push({
      type: 'element',
      tagName: SCRIPTURE_LINK_TAG,
      properties: { dataReference: JSON.stringify({ raw, reference, writtenIn }) },
      children: [{ type: 'text', value: raw }],
    });
    at = end;
  }
  if (at < value.length) parts.push({ type: 'text', value: value.slice(at) });
  return parts;
}

function linkChildren(parent: Root | Element, locale: AppLocale, written: AppLocale | null): void {
  const next: Array<RootContent | ElementContent> = [];
  for (const child of parent.children) {
    if (child.type === 'text') {
      next.push(...linkedText(child.value, locale, written));
      continue;
    }
    if (child.type === 'element' && !LEFT_AS_WRITTEN.has(child.tagName)) linkChildren(child, locale, written);
    next.push(child);
  }
  parent.children = next as typeof parent.children;
}

/**
 * The Markdown side: a rehype plugin that turns the references in rendered text into
 * `SCRIPTURE_LINK_TAG` elements, drawn by `MarkdownScriptureLink`. Runs after sanitizing, so only
 * the app makes these elements, never the text. `written` — the language of the document, else of the
 * whole Markdown: a piece of text between two marks rarely says it.
 */
export function rehypeScriptureLinks(locale: AppLocale, written: AppLocale | null = null) {
  return (tree: Root) => linkChildren(tree, locale, written);
}

/** Draws a `SCRIPTURE_LINK_TAG` element of rendered Markdown. */
export function MarkdownScriptureLink({ children, ...props }: { children?: ReactNode; 'data-reference'?: string }) {
  const data = props['data-reference'];
  const found = useMemo(() => {
    try {
      return JSON.parse(data ?? '') as Pick<ReferenceInText, 'raw' | 'reference' | 'writtenIn'>;
    } catch {
      return null;
    }
  }, [data]);
  return found ? <ScriptureLink found={found}>{children}</ScriptureLink> : <>{children}</>;
}
