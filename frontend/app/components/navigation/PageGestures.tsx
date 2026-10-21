'use client';

import { ChevronLeft } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useShellPathname } from '@/hooks/useShellPathname';

import { BACK_THRESHOLD, usePageGestures } from './gestures/usePageGestures';

import type { GestureView, PageOffset } from './gestures/usePageGestures';
import type { CSSProperties, HTMLAttributes } from 'react';

function feedbackKey(view: GestureView): string {
  return view.kind === 'leaving' || view.distance >= BACK_THRESHOLD ? 'gestures.releaseBack' : 'gestures.back';
}

/** Released or abandoned: the page glides; under the finger it follows exactly. */
function motionClass(kind: GestureView['kind']): string {
  if (kind === 'leaving') return 'motion-safe:transition-[left] motion-safe:duration-200 motion-safe:ease-in';
  if (kind === 'settling') return 'motion-safe:transition-[left,box-shadow] motion-safe:duration-[250ms] motion-safe:ease-out';
  return '';
}

function surfaceStyle(view: GestureView, style: CSSProperties | undefined): CSSProperties | undefined {
  if (view.kind === 'idle') return style;
  const left = view.kind === 'back' || view.kind === 'leaving' ? view.distance : 0;
  // Relative offsets, not a transform: a transformed ancestor would turn every fixed bar into part of
  // the page box. Fixed page chrome marked `page-gesture-follow` reads the same offset (globals.css).
  return {
    ...style,
    position: 'relative',
    left,
    ['--page-gesture-x' as string]: `${left}px`,
    boxShadow: left ? '-16px 0 32px -12px rgba(0, 0, 0, 0.3)' : 'none',
  };
}

type PageGesturesProps = HTMLAttributes<HTMLDivElement> & { enabled?: boolean };

/**
 * The page itself, moved by the finger: swiped right to go back.
 * It renders the layout's root element so that the whole page travels, as in Safari.
 */
export default function PageGestures({ enabled = true, children, className, style, ...attributes }: PageGesturesProps) {
  const { t } = useTranslation();
  const pathname = useShellPathname();
  const search = useSearchParams();
  const router = useRouter();
  const surface = useRef<HTMLDivElement>(null);
  const view = usePageGestures({
    routeKey: `${pathname}?${search?.toString() ?? ''}`,
    enabled,
    onBack: () => router.back(),
    // Mid-animation the computed offset is the drawn one, so a caught page continues from there.
    readOffset: (): PageOffset => {
      const computed = surface.current ? getComputedStyle(surface.current) : null;
      return { x: parseFloat(computed?.left ?? '') || 0 };
    },
  });
  const moving = view.kind !== 'idle';

  // A page pushed sideways would widen the document; clip it for the gesture only, never for good.
  useEffect(() => {
    const parent = surface.current?.parentElement;
    if (!moving || !parent) return;
    const before = parent.style.overflowX;
    parent.style.overflowX = 'clip';
    return () => { parent.style.overflowX = before; };
  }, [moving]);

  const sideways = view.kind === 'back' || view.kind === 'leaving';

  return (
    <div
      {...attributes}
      ref={surface}
      data-page-gesture={view.kind}
      className={[className, motionClass(view.kind)].filter(Boolean).join(' ')}
      style={surfaceStyle(view, style)}
    >
      {moving && (
        <>
          {/* What the moving page uncovers. */}
          <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 bg-gray-100 dark:bg-gray-950" />
          {sideways && (
            <div
              aria-hidden="true"
              className={`pointer-events-none fixed top-1/2 z-[300] flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full shadow-sm motion-safe:transition-colors ${view.kind === 'leaving' ? 'opacity-0' : ''} ${view.distance >= BACK_THRESHOLD ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'bg-white text-gray-500 dark:bg-gray-800 dark:text-gray-300'}`}
              style={view.kind === 'leaving' ? undefined : { left: Math.max(8, view.distance / 2 - 20), opacity: Math.min(1, view.distance / BACK_THRESHOLD) }}
            >
              <ChevronLeft className="h-6 w-6" />
            </div>
          )}
          {view.kind !== 'settling' && (
            <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
              {t(feedbackKey(view))}
            </div>
          )}
        </>
      )}
      {children}
    </div>
  );
}
