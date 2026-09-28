'use client';

import { ArrowDown, ArrowLeft, LoaderCircle } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslation } from 'react-i18next';

import { useShellPathname } from '@/hooks/useShellPathname';
import { reloadPage } from '@/utils/reloadPage';

import { BACK_THRESHOLD, PULL_THRESHOLD, usePageGestures } from './gestures/usePageGestures';

import type { GestureView } from './gestures/usePageGestures';

function feedbackKey(view: GestureView): string {
  if (view.kind === 'back') return view.distance >= BACK_THRESHOLD ? 'gestures.releaseBack' : 'gestures.back';
  if (view.kind === 'refreshing') return 'gestures.refreshing';
  if (view.kind === 'error') return 'gestures.failed';
  return view.distance >= PULL_THRESHOLD ? 'gestures.releaseRefresh' : 'gestures.pullRefresh';
}

export default function PageGestures({ enabled = true }: { enabled?: boolean }) {
  const { t } = useTranslation();
  const pathname = useShellPathname();
  const search = useSearchParams();
  const router = useRouter();
  const view = usePageGestures({
    routeKey: `${pathname}?${search?.toString() ?? ''}`,
    enabled,
    onBack: () => router.back(),
    onRefresh: reloadPage,
  });
  const back = view.kind === 'back';
  const ready = view.distance >= (back ? BACK_THRESHOLD : PULL_THRESHOLD);
  const label = t(feedbackKey(view));

  return (
    <div data-page-gesture={view.kind} className="pointer-events-none fixed inset-0 z-[90]" aria-hidden={view.kind === 'idle'}>
      {view.kind !== 'idle' && (
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={`absolute flex items-center gap-2 rounded-full border border-gray-200 bg-white/95 px-4 py-3 text-sm font-medium text-gray-700 shadow-md dark:border-gray-700 dark:bg-gray-800/95 dark:text-gray-100 ${back ? 'left-2 top-1/2' : 'left-1/2 -translate-x-1/2'}`}
          style={back ? { transform: `translateX(${Math.min(24, view.distance / 5)}px)` }
            : { top: `calc(env(safe-area-inset-top, 0px) + ${Math.max(8, view.distance - 32)}px)` }}
        >
          {view.kind === 'refreshing' ? <LoaderCircle aria-hidden="true" className="h-5 w-5 motion-safe:animate-spin" />
            : back ? <ArrowLeft aria-hidden="true" className="h-5 w-5" />
              : view.kind !== 'error' && <ArrowDown aria-hidden="true" className={`h-5 w-5 motion-safe:transition-transform ${ready ? 'rotate-180' : ''}`} />}
          <span>{label}</span>
        </div>
      )}
    </div>
  );
}
