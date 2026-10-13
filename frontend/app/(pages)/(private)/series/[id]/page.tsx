'use client';

import { EngineSeriesDetail } from '@/components/series/EngineSeriesDetail';
import { useRouteId } from '@/hooks/useRouteId';

/** One series. Series are read and written only through the data engine (engineOwnedCollections.ts). */
export default function SeriesDetailPage() {
  const id = useRouteId();
  return <EngineSeriesDetail key={id} seriesId={typeof id === 'string' ? id : ''} />;
}
