'use client';

import { useCallback, useMemo, useRef, useState } from 'react';

export interface OwnedTextDocument {
  install(value: string): void;
  /** False means the editor reports an active composition. */
  append(value: string): boolean | void;
  waitForComposition?(): Promise<void>;
  replace(value: string): void;
}

/** The editor joins this owner during construction, before any input can reach it. */
export interface EditorTextOwner {
  live(): string;
  emit(value: string): void;
  /** A native input event is still completing its ordinary observer turn. */
  nativeInput?(): void;
  register(document: OwnedTextDocument): () => void;
}

export function useEditorOwnedText(initial: string) {
  const [text, setText] = useState(initial);
  const current = useRef(initial);
  const document = useRef<OwnedTextDocument | null>(null);
  const pendingAppend = useRef<Promise<void> | null>(null);
  const nativeTurn = useRef<Promise<void> | null>(null);
  const nativeInput = useCallback(() => {
    const turn = Promise.resolve();
    nativeTurn.current = turn;
    void turn.then(() => { if (nativeTurn.current === turn) nativeTurn.current = null; });
  }, []);
  const live = useCallback(() => current.current, []);
  const publish = useCallback((value: string) => {
    current.current = value;
    setText(value);
  }, []);
  const ownedBy = useMemo<EditorTextOwner>(() => ({
    live,
    emit: publish,
    nativeInput,
    register: instance => {
      document.current = instance;
      return () => { if (document.current === instance) document.current = null; };
    },
  }), [live, publish, nativeInput]);
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
    const inputTurn = nativeTurn.current;
    if (!inputTurn && !previous && apply()) return;
    const pendingDocument = document.current;
    const operation = (async () => {
      // The editor signals composition completion; receipt order belongs to this owner.
      // This is an observed input event, not a document/DOM comparison. A browser's
      // timer-deferred observer remains a separate, documented acceptance boundary.
      if (inputTurn) await inputTurn;
      if (previous) await previous;
      else if (!inputTurn) await pendingDocument!.waitForComposition!();
      for (;;) {
        if (document.current !== pendingDocument) throw new Error('The note editor closed before text could be appended');
        if (apply()) return;
        await pendingDocument!.waitForComposition!();
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
