'use client';

import { useCallback, useMemo, useRef, useState } from 'react';

export interface OwnedTextDocument {
  install(value: string): void;
  append(block: string): void;
  replace(value: string): void;
}

/** The editor joins this owner during construction, before any input can reach it. */
export interface EditorTextOwner {
  live(): string;
  emit(value: string): void;
  register(document: OwnedTextDocument): () => void;
}

export function useEditorOwnedText(initial: string) {
  const [text, setText] = useState(initial);
  const current = useRef(initial);
  const document = useRef<OwnedTextDocument | null>(null);
  const live = useCallback(() => current.current, []);
  const publish = useCallback((value: string) => {
    current.current = value;
    setText(value);
  }, []);
  const ownedBy = useMemo<EditorTextOwner>(() => ({
    live,
    emit: publish,
    register: instance => {
      document.current = instance;
      return () => { if (document.current === instance) document.current = null; };
    },
  }), [live, publish]);
  const follow = useCallback((value: string) => {
    if (value === current.current) return;
    document.current?.install(value);
    publish(value);
  }, [publish]);
  const append = useCallback((block: string) => {
    document.current?.append(block);
    // Dictation must not round-trip source that the editor cannot represent.
    publish(current.current ? `${current.current}\n\n${block}` : block);
  }, [publish]);
  const replace = useCallback((value: string) => {
    document.current?.replace(value);
    publish(value);
  }, [publish]);
  return { text, live, follow, append, replace, ownedBy };
}
