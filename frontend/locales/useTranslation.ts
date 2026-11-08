'use client';

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import {
  useTranslation as useLibraryTranslation,
  type FallbackNs,
  type UseTranslationOptions,
  type UseTranslationResponse,
} from 'react-i18next';

import { DEFAULT_LANGUAGE } from './constants';
// A shared component can be the first translated consumer during prerendering.
import './i18n';

import type { FlatNamespace, KeyPrefix } from 'i18next';

type NamespaceList = readonly FlatNamespace[];
const SERVER_LANGUAGE = JSON.stringify([DEFAULT_LANGUAGE, DEFAULT_LANGUAGE]);

/**
 * One language snapshot for rendered text, dates and attributes. The live i18n instance
 * remains the library's writer; render code reads `language` instead of its mutable field.
 * React uses the default only while hydrating each server-rendered boundary, then checks
 * the current language again, including a change made before its subscription committed.
 */
export function useTranslation<
  Ns extends FlatNamespace | NamespaceList | undefined = undefined,
  KPrefix extends KeyPrefix<FallbackNs<Ns>> = undefined,
>(
  ns?: Ns,
  options?: UseTranslationOptions<KPrefix>,
): UseTranslationResponse<FallbackNs<Ns>, KPrefix> & { language: string; resolvedLanguage: string | undefined } {
  const result = useLibraryTranslation(ns, options);
  const { i18n, t: libraryT, ready } = result;
  const events = options?.bindI18n ?? i18n?.options?.react?.bindI18n ?? 'languageChanged';
  const subscribe = useCallback((changed: () => void) => {
    if (!events || !i18n?.on) return () => {};
    i18n.on(events, changed);
    return () => { events.split(' ').forEach(event => i18n.off(event, changed)); };
  }, [i18n, events]);
  const getSnapshot = useCallback(() => JSON.stringify([
    i18n?.language || DEFAULT_LANGUAGE, i18n?.resolvedLanguage ?? null,
  ]), [i18n]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerLanguage);
  const [language, resolvedLanguage] = useMemo(() => {
    const [current, resolved] = JSON.parse(snapshot) as [string, string | null];
    return [current, resolved ?? undefined] as const;
  }, [snapshot]);
  const translationLanguage = options?.lng || language;
  const committed = useRef(false);
  useEffect(() => { committed.current = true; }, []);
  const t = useMemo(() => {
    // The library owns namespace/provider/defaultNS and keyPrefix selection. Its bound
    // getFixedT function carries that selection; rebinding only the language preserves
    // i18next's overloads, per-call overrides, interpolation and namespace fallback.
    if (!i18n?.getFixedT) return libraryT;
    const bound = libraryT as typeof libraryT & {
      ns: FallbackNs<Ns>;
      keyPrefix?: KPrefix;
    };
    const initialT = i18n.getFixedT<FallbackNs<Ns>, KPrefix>(translationLanguage, bound.ns, bound.keyPrefix);
    if (options?.lng) return initialT;
    // Pin the first render to its snapshot, including delayed hydration. After commit,
    // a retained callback must retain the library's live-language behavior: an async
    // completion after a language switch speaks the current language, not the old one.
    const liveT = i18n.getFixedT<FallbackNs<Ns>, KPrefix>(null, bound.ns, bound.keyPrefix);
    return Object.assign((...args: unknown[]) =>
      Reflect.apply(committed.current ? liveT : initialT, undefined, args), liveT) as typeof libraryT;
  }, [i18n, libraryT, translationLanguage, options?.lng]);

  return useMemo(() => Object.assign([t, i18n, ready] as [typeof t, typeof i18n, boolean], {
    t, i18n, ready, language, resolvedLanguage,
  }), [t, i18n, ready, language, resolvedLanguage]);
}

function getServerLanguage() {
  return SERVER_LANGUAGE;
}
