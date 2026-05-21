import { type RefObject, useEffect, useRef } from 'react';

interface UseClickOutsideOptions {
  enabled?: boolean;
  capture?: boolean;
  event?: 'mousedown' | 'click';
}

export function useClickOutside(
  refs: Array<RefObject<Element | null>>,
  handler: () => void,
  options?: UseClickOutsideOptions
): void {
  const refsRef = useRef(refs);
  const handlerRef = useRef(handler);
  const enabled = options?.enabled ?? true;
  const capture = options?.capture ?? false;
  const eventName = options?.event ?? 'mousedown';

  refsRef.current = refs;
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return undefined;

    const handleDocumentEvent = (event: MouseEvent): void => {
      const target = typeof Node !== 'undefined' && event.target instanceof Node
        ? event.target
        : null;

      if (!target) return;

      const isInside = refsRef.current.some((ref) => {
        const element = ref.current;
        return element ? element.contains(target) : false;
      });

      if (!isInside) {
        handlerRef.current();
      }
    };

    document.addEventListener(eventName, handleDocumentEvent, capture);

    return () => {
      document.removeEventListener(eventName, handleDocumentEvent, capture);
    };
  }, [capture, enabled, eventName]);
}
