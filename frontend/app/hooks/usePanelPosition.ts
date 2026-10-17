"use client";

import { useLayoutEffect, type RefObject } from 'react';

import { PANEL_EDGE_PADDING, panelHorizontalSpace, panelShift } from '@/utils/panelPlacement';

/** Measure an anchored panel in place, keeping its DOM ownership and existing transform. */
export function usePanelPosition(ref: RefObject<HTMLElement | null>, open: boolean, placementKey = ''): void {
  useLayoutEffect(() => {
    const panel = ref.current;
    if (!open || !panel) return;
    const originalTranslate = panel.style.translate ?? '';
    let active = true;
    const originalMaxWidth = panel.style.maxWidth;
    const place = () => {
      if (!active) return;
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const space = panelHorizontalSpace(panel, viewportWidth);
      const availableWidth = space.right - space.left;
      panel.style.maxWidth = `${Math.max(0, availableWidth - 2 * PANEL_EDGE_PADDING)}px`;
      panel.style.translate = '0px';
      const rect = panel.getBoundingClientRect();
      if (!rect.width) return;
      panel.style.translate = `${panelShift(rect, availableWidth, space.left)}px 0px`;
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    // A responsive ancestor may animate its width while the small anchor stays fixed.
    // Keep following that layout until its transition has finished.
    for (let element: HTMLElement | null = panel; element; element = element.parentElement) {
      observer?.observe(element);
    }
    return () => {
      active = false;
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      observer?.disconnect();
      panel.style.translate = originalTranslate;
      panel.style.maxWidth = originalMaxWidth;
    };
  }, [ref, open, placementKey]);
}
