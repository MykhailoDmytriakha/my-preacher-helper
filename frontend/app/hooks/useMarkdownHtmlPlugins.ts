'use client';

import { useId, useMemo } from 'react';

import { createMarkdownHtmlPlugins } from '@/utils/markdownHtml';

/** A reading card keeps stable, independent fragment targets across content changes. */
export function useMarkdownHtmlPlugins() {
  const scope = useId();
  return useMemo(() => createMarkdownHtmlPlugins(scope), [scope]);
}
