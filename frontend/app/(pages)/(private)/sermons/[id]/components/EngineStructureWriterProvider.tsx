'use client';

import { StructureWriterContext } from '@/components/sermon/structureWriter';
import { useDataEngine } from '@/data-engine/react.client';

import { useEngineStructureWriter } from '../structure/useEngineStructureWriter';

import type { ReactNode } from 'react';

/**
 * The sermon page on an engine document writes its outline through the engine writer the
 * structure screen uses: the page outline and the structure editor alike. That writer lays each
 * change over the document's current copy and re-points or releases the thoughts of a moved or
 * deleted point in the same change. Must render inside the sermon's DataDocumentProvider.
 */
export function EngineStructureWriterProvider({ sermonId, children }: { sermonId: string; children: ReactNode }) {
  const { owner } = useDataEngine();
  const { writer } = useEngineStructureWriter(sermonId, owner);
  return <StructureWriterContext.Provider value={writer}>{children}</StructureWriterContext.Provider>;
}
