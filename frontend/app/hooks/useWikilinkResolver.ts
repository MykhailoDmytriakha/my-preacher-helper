import { useCallback, useMemo, useRef } from 'react';

import { useStudyNotes } from './useStudyNotes';

/**
 * Returns a resolver `(id) => title | undefined` for `[[noteId]]` wikilinks,
 * derived from the user's cached study notes. Pass the result into
 * MarkdownDisplay's `wikilinkResolver` prop so chips show readable titles
 * instead of opaque IDs.
 *
 * **The returned function has a stable identity for the lifetime of the
 * hook.** It reads the latest title-map via a ref, so consumers that close
 * over the function (e.g. tiptap extension options) don't churn when the
 * notes cache hydrates. Callers that depend on the result still see fresh
 * titles on every call.
 *
 * Returns `undefined` for unknown IDs — consumers fall back to rendering
 * the raw ID, which keeps the link useful while the cache loads.
 */
export function useWikilinkResolver(): (id: string) => string | undefined {
  const { notes } = useStudyNotes();

  const titleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const note of notes) {
      const title = note.title?.trim();
      if (title) map.set(note.id, title);
    }
    return map;
  }, [notes]);

  const titleByIdRef = useRef(titleById);
  titleByIdRef.current = titleById;

  return useCallback((id: string) => titleByIdRef.current.get(id), []);
}
