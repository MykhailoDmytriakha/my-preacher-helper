'use client';

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState } from 'react';

import type { ReactNode } from 'react';

type Publish = (key: string, publisher: string, title: string | null) => void;
/** Per document, the title each mounted publisher holds, in the order they published. */
type Titles = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** Stable: a page that publishes does not re-render when another title changes. */
const PublishContext = createContext<Publish | null>(null);
const TitlesContext = createContext<Titles>({});

const keyOf = (collection: string, id: string) => `${collection}/${id}`;

/**
 * Titles the open page shows, for the shell around it (the breadcrumbs).
 *
 * A page that already holds a document publishes that document's title, so the trail names exactly
 * what the page shows: a rename reaches it at once, offline included, and the header opens no read of
 * its own. Without it, on the data engine the trail read the legacy cache, which engine writes never
 * update (BUG-20261004-breadcrumb-keeps-old-sermon-title).
 *
 * One page may hold the same document in more than one hook (the sermon page and its structure
 * writer), so each publisher keeps its own entry and withdraws only that one.
 */
export function ShellTitlesProvider({ children }: { children: ReactNode }) {
  const [titles, setTitles] = useState<Titles>({});
  const publish = useCallback<Publish>((key, publisher, title) => {
    setTitles((current) => {
      const entries = current[key] ?? {};
      if (title === null) {
        if (!(publisher in entries)) return current;
        const rest = { ...entries };
        delete rest[publisher];
        const next = { ...current };
        if (Object.keys(rest).length) next[key] = rest;
        else delete next[key];
        return next;
      }
      if (entries[publisher] === title) return current;
      const rest = { ...entries };
      delete rest[publisher];
      return { ...current, [key]: { ...rest, [publisher]: title } };
    });
  }, []);
  return (
    <PublishContext.Provider value={publish}>
      <TitlesContext.Provider value={titles}>{children}</TitlesContext.Provider>
    </PublishContext.Provider>
  );
}

/**
 * Called by the hook that holds the document the page renders, with that document's data; withdraws
 * its title when it unmounts. A document not loaded yet publishes nothing, so the trail keeps its
 * fallback; a loaded document without a title publishes an empty title, so the trail shows its generic
 * label instead of an old cached name.
 */
export function usePublishShellTitle(collection: string, id: string | null | undefined, data: { title?: unknown } | null | undefined) {
  const publish = useContext(PublishContext);
  const publisher = useId();
  const text = data ? (typeof data.title === 'string' ? data.title.trim() : '') : null;
  useEffect(() => {
    if (!publish || !id || text === null) return undefined;
    const key = keyOf(collection, id);
    publish(key, publisher, text);
    return () => publish(key, publisher, null);
  }, [publish, publisher, collection, id, text]);
}

/**
 * The title the open page shows for this document (the latest publisher's): '' when the page holds the
 * document but it has no title, null when no page that holds it is mounted.
 */
export function useShellTitle(collection: string, id: string | null | undefined): string | null {
  const titles = useContext(TitlesContext);
  return useMemo(() => {
    const entries = id ? titles[keyOf(collection, id)] : undefined;
    const values = entries ? Object.values(entries) : [];
    return values.length ? values[values.length - 1] : null;
  }, [titles, collection, id]);
}
