'use client';

import { useEffect, useRef, useState } from 'react';

import { recordDiagnostic } from '@/utils/appDiagnostics';
import { isIPadStandalonePwa } from '@/utils/pwaEnv';

import { gestureBlockReason, hasOpenLayer, pageAtTop } from './touchTargets';

export const PULL_THRESHOLD = 72;
export const BACK_THRESHOLD = 90;
const EDGE_WIDTH = 28;
const SLOP = 8;
const RELOAD_START_TIMEOUT_MS = 5000;
const CLICKABLE = 'a, button, label, [role="button"]';

type Gesture = {
  identifier: number;
  x: number;
  y: number;
  target: Element;
  top: boolean;
  canGoBack: boolean;
  direction: 'pending' | 'refresh' | 'back';
  distance: number;
};
export type GestureView = { kind: 'idle' | 'pull' | 'back' | 'refreshing' | 'error'; distance: number };
const IDLE: GestureView = { kind: 'idle', distance: 0 };

export function usePageGestures({ routeKey, enabled, onRefresh, onBack }: {
  routeKey: string;
  enabled: boolean;
  onRefresh: () => void;
  onBack: () => void;
}) {
  const [view, setView] = useState<GestureView>(IDLE);
  const actions = useRef({ onRefresh, onBack });
  actions.current = { onRefresh, onBack };

  useEffect(() => {
    setView(IDLE);
    if (!enabled || !isIPadStandalonePwa()) return;
    recordDiagnostic('gesture', { source: 'setup', result: 'enabled', route: routeKey });
    let reloading = false;
    let gesture: Gesture | null = null;
    let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
    let reloadTimer: ReturnType<typeof setTimeout> | undefined;
    let clickTimer: ReturnType<typeof setTimeout> | undefined;
    let clickTarget: Element | null = null;
    const cancel = (reason?: string) => {
      if (gesture && reason) recordDiagnostic('gesture', { source: gesture.direction, result: 'cancelled', code: reason });
      gesture = null;
      setView(reloading ? { kind: 'refreshing', distance: PULL_THRESHOLD } : IDLE);
    };
    const start = (event: TouchEvent) => {
      cancel();
      clickTarget = null;
      clearTimeout(clickTimer);
      if (event.defaultPrevented || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const canGoBack = window.history.length > 1;
      const top = pageAtTop() && !reloading;
      if (!top && !canGoBack) return;
      const blocked = gestureBlockReason(event.target)
        ?? (window.visualViewport && window.visualViewport.scale !== 1 ? 'zoomed' : null);
      if (blocked) { recordDiagnostic('gesture', { source: 'start', result: 'blocked', code: blocked }); return; }
      const target = event.target as Element;
      // Claim a free edge before WebKit can also navigate, but preserve ordinary control taps.
      if (canGoBack && touch.clientX <= EDGE_WIDTH && !target.closest(CLICKABLE)) {
        if (!event.cancelable) return;
        event.preventDefault();
      }
      clearTimeout(feedbackTimer);
      gesture = { identifier: touch.identifier, x: touch.clientX, y: touch.clientY, target, top, canGoBack, direction: 'pending', distance: 0 };
    };
    const move = (event: TouchEvent) => {
      if (!gesture) return;
      if (event.touches.length !== 1 || hasOpenLayer() || event.defaultPrevented) { cancel('interrupted'); return; }
      const touch = Array.from(event.touches).find(item => item.identifier === gesture?.identifier);
      if (!touch || !event.cancelable) { cancel('browser-owned'); return; }
      const dx = touch.clientX - gesture.x, dy = touch.clientY - gesture.y;
      if (gesture.direction === 'pending') {
        // Claim the intended axis before the browser turns it into scrolling.
        if (!gesture.target.closest(CLICKABLE) && ((gesture.top && dy > 0 && dy > Math.abs(dx))
          || (gesture.canGoBack && dx > 0 && dx > Math.abs(dy)))) event.preventDefault();
        if (Math.max(Math.abs(dx), Math.abs(dy)) < SLOP) return;
        if (gesture.canGoBack && dx > Math.abs(dy) * 1.5) gesture.direction = 'back';
        else if (gesture.top && pageAtTop() && dy > Math.abs(dx) * 1.5) gesture.direction = 'refresh';
        else { cancel('direction'); return; }
        clickTarget = gesture.target.closest(CLICKABLE);
        recordDiagnostic('gesture', { source: gesture.direction, result: 'tracking' });
      }
      event.preventDefault();
      gesture.distance = gesture.direction === 'refresh'
        ? Math.min(112, Math.max(0, dy) * 0.5) : Math.min(160, Math.max(0, dx));
      setView({ kind: gesture.direction === 'refresh' ? 'pull' : 'back', distance: gesture.distance });
    };
    const finish = (event: TouchEvent) => {
      clickTimer = setTimeout(() => { clickTarget = null; }, 700);
      const completed = gesture;
      if (!completed) return;
      gesture = null;
      if (event.touches.length || hasOpenLayer() || !Array.from(event.changedTouches).some(touch => touch.identifier === completed.identifier)) { cancel(); return; }
      if (completed.direction === 'back' && completed.distance >= BACK_THRESHOLD) {
        setView(IDLE);
        recordDiagnostic('gesture', { source: 'back', result: 'released' });
        actions.current.onBack();
        return;
      }
      if (completed.direction !== 'refresh' || completed.distance < PULL_THRESHOLD || reloading) { cancel(); return; }
      reloading = true;
      setView({ kind: 'refreshing', distance: PULL_THRESHOLD });
      const failed = (code: string) => {
        clearTimeout(reloadTimer);
        reloading = false;
        recordDiagnostic('gesture', { source: 'reload', result: 'failed', code });
        setView({ kind: 'error', distance: PULL_THRESHOLD });
        feedbackTimer = setTimeout(() => setView(IDLE), 4000);
      };
      // The document reload starts now, exactly like the header button. Do not await data readers.
      recordDiagnostic('gesture', { source: 'reload', result: 'requested' });
      reloadTimer = setTimeout(() => failed('navigation-not-started'), RELOAD_START_TIMEOUT_MS);
      try { actions.current.onRefresh(); } catch { failed('reload-rejected'); }
    };
    const click = (event: MouseEvent) => {
      if (event.detail === 0 || !clickTarget || !(event.target instanceof Node) || !clickTarget.contains(event.target)) return;
      event.preventDefault(); event.stopPropagation(); clickTarget = null;
    };
    const interrupted = () => cancel('touch-cancelled');
    const pageChanged = () => { reloading = false; clearTimeout(reloadTimer); clearTimeout(feedbackTimer); cancel(); };
    document.addEventListener('touchstart', start, { passive: false });
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', finish, { passive: true });
    document.addEventListener('touchcancel', interrupted, { passive: true });
    document.addEventListener('click', click, true);
    window.addEventListener('pagehide', pageChanged);
    window.addEventListener('pageshow', pageChanged);
    return () => {
      clearTimeout(feedbackTimer); clearTimeout(reloadTimer); clearTimeout(clickTimer);
      document.removeEventListener('touchstart', start);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', finish);
      document.removeEventListener('touchcancel', interrupted);
      document.removeEventListener('click', click, true);
      window.removeEventListener('pagehide', pageChanged);
      window.removeEventListener('pageshow', pageChanged);
    };
  }, [routeKey, enabled]);

  return view;
}
