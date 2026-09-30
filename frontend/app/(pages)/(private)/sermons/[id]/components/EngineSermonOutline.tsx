'use client';

import SermonOutline from '@/components/sermon/SermonOutline';
import { StructureWriterContext } from '@/components/sermon/structureWriter';
import { useDataEngine } from '@/data-engine/react.client';

import { useEngineStructureWriter } from '../structure/useEngineStructureWriter';

import type { ComponentProps } from 'react';

type Props = Omit<ComponentProps<typeof SermonOutline>, 'onOutlinePointDeleted' | 'onSubPointDeleted'>;

/**
 * The sermon page's outline on an engine document: the same panel, writing through the engine
 * writer the structure screen uses. That writer re-points or releases the thoughts of a moved or
 * deleted point in the same change, so the legacy follow-up thought writes are not passed in.
 * Must render inside the sermon's DataDocumentProvider.
 */
export function EngineSermonOutline(props: Props) {
  const { owner } = useDataEngine();
  const { writer } = useEngineStructureWriter(props.sermon.id, owner);
  return <StructureWriterContext.Provider value={writer}><SermonOutline {...props} /></StructureWriterContext.Provider>;
}
