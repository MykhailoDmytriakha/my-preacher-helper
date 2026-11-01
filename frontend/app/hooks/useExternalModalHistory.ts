'use client';

import { useLayoutEffect, useRef, useState } from 'react';

import { registerModalLayer } from '@/utils/modalLayerRegistry';

/** Join browser-history ordering while the dialog library retains its focus trap and scroll lock. */
export function useExternalModalHistory<T extends HTMLElement = HTMLDivElement>({
  active,
  onClose,
  closeDisabled = false,
}: { active: boolean; onClose: () => void; closeDisabled?: boolean }): React.RefCallback<T> {
  const [element, setElement] = useState<T | null>(null);
  const close = useRef({ onClose, closeDisabled });
  useLayoutEffect(() => { close.current = { onClose, closeDisabled }; });
  useLayoutEffect(() => {
    if (!active || !element) return;
    return registerModalLayer(element, null, null, element, () => {
      if (!close.current.closeDisabled) close.current.onClose();
    }, true);
  }, [active, element]);
  return setElement;
}
