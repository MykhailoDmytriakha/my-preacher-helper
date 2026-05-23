'use client';

import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import Link from 'next/link';

import { useWikilinkResolver } from '@/hooks/useWikilinkResolver';

import {
  STUDIES_LINK_PREFIX,
  WIKILINK_CHIP_CLASS,
  WIKILINK_CHIP_GLYPH,
  WIKILINK_DATA_ATTR,
} from './wikilinkConstants';

export function WikilinkChip({ node }: NodeViewProps) {
  const resolveWikilink = useWikilinkResolver();
  const id = typeof node.attrs.id === 'string' ? node.attrs.id : '';
  const resolvedTitle = resolveWikilink(id)?.trim();
  const label = resolvedTitle && resolvedTitle.length > 0 ? resolvedTitle : id;
  const wikilinkDataAttribute = { [WIKILINK_DATA_ATTR]: id };

  return (
    <NodeViewWrapper as="span" contentEditable={false}>
      <Link
        href={`${STUDIES_LINK_PREFIX}${id}`}
        className={WIKILINK_CHIP_CLASS}
        onClick={(event) => event.stopPropagation()}
        {...wikilinkDataAttribute}
      >
        {WIKILINK_CHIP_GLYPH} {label}
      </Link>
    </NodeViewWrapper>
  );
}

export default WikilinkChip;
