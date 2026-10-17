"use client";

import { useLayoutEffect, type RefObject } from 'react';

import { PANEL_EDGE_PADDING, panelHorizontalSpace, panelShift, panelVerticalPlacement, panelVerticalSpace, type PanelSide } from '@/utils/panelPlacement';

type VerticalPanelOptions = { anchor: RefObject<HTMLElement | null>; side: PanelSide };

/** Measure an anchored panel in place, keeping its DOM ownership and existing transform. */
export function usePanelPosition(
  ref: RefObject<HTMLElement | null>, open: boolean, placementKey = '', vertical?: VerticalPanelOptions
): void {
  const anchor = vertical?.anchor;
  const side = vertical?.side;
  useLayoutEffect(() => {
    const panel = ref.current;
    if (!open || !panel) return;
    const originalTranslate = panel.style.translate ?? '';
    let active = true;
    const originalMaxWidth = panel.style.maxWidth;
    const originalMaxHeight = panel.style.maxHeight;
    const originalOverflowY = panel.style.overflowY;
    const place = () => {
      if (!active) return;
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const space = panelHorizontalSpace(panel, viewportWidth);
      const availableWidth = space.right - space.left;
      panel.style.maxWidth = `${Math.max(0, availableWidth - 2 * PANEL_EDGE_PADDING)}px`;
      panel.style.translate = '0px';
      let placement: ReturnType<typeof panelVerticalPlacement> | undefined;
      const trigger = anchor?.current;
      if (trigger && side) {
        const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
        const naturalHeight = Math.max(panel.scrollHeight, panel.getBoundingClientRect().height);
        placement = panelVerticalPlacement(trigger.getBoundingClientRect(), naturalHeight, panelVerticalSpace(panel, viewportHeight), side);
        panel.style.maxHeight = `${placement.maxHeight}px`;
        panel.style.overflowY = 'auto';
      }
      const rect = panel.getBoundingClientRect();
      if (!rect.width) return;
      panel.style.translate = `${panelShift(rect, availableWidth, space.left)}px ${placement ? placement.top - rect.top : 0}px`;
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
      panel.style.maxHeight = originalMaxHeight;
      panel.style.overflowY = originalOverflowY;
    };
  }, [ref, open, placementKey, anchor, side]);
}
