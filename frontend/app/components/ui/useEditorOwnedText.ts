'use client';

import { useCallback, useMemo, useRef, useState } from 'react';

export interface OwnedTextDocument {
  install(value: string): void;
  /** False means native input has not yet reached the document. */
  append(value: string): boolean | void;
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
  const pendingAppend = useRef<Promise<void> | null>(null);
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
  const append = useCallback((block: string): void | Promise<void> => {
    const apply = () => {
      // Recompute after native input has emitted; retain unsupported raw source otherwise.
      const value = current.current ? `${current.current}\n\n${block}` : block;
      if (document.current?.append(value) === false) return false;
      publish(value);
      return true;
    };
    const previous = pendingAppend.current;
    if (!previous && apply()) return;
    const pendingDocument = document.current;
    const operation = (async () => {
      // Keep receipt order while MutationObserver or composition admits the native input.
      if (previous) await previous;
      else await Promise.resolve();
      for (;;) {
        if (document.current !== pendingDocument) throw new Error('The note editor closed before text could be appended');
        if (apply()) return;
        await new Promise<void>(resolve => setTimeout(resolve, 20));
      }
    })();
    pendingAppend.current = operation;
    const release = () => { if (pendingAppend.current === operation) pendingAppend.current = null; };
    void operation.then(release, release);
    return operation;
  }, [publish]);
  const replace = useCallback((value: string) => {
    if (value === current.current) return;
    document.current?.replace(value);
    publish(value);
  }, [publish]);
  return { text, live, follow, append, replace, ownedBy };
}
