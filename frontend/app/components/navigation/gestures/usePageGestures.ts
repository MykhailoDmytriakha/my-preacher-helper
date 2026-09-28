'use client';

import { useEffect, useRef, useState } from 'react';

import { isIPadStandalonePwa } from '@/utils/pwaEnv';

import { gestureTarget, hasOpenLayer, pageAtTop } from './touchTargets';

export const PULL_THRESHOLD = 72;
export const BACK_THRESHOLD = 90;
const EDGE_WIDTH = 28;
const SLOP = 8;
const REFRESH_TIMEOUT_MS = 15_000;

type Gesture = {
  identifier: number;
  x: number;
  y: number;
  top: boolean;
  edge: boolean;
  direction: 'pending' | 'refresh' | 'back';
  distance: number;
};
export type GestureView = { kind: 'idle' | 'pull' | 'back' | 'refreshing' | 'error'; distance: number };
const IDLE: GestureView = { kind: 'idle', distance: 0 };

export function usePageGestures({ routeKey, enabled, onRefresh, onBack }: {
  routeKey: string;
  enabled: boolean;
  onRefresh: () => Promise<void>;
  onBack: () => void;
}) {
  const [view, setView] = useState<GestureView>(IDLE);
  const actions = useRef({ onRefresh, onBack });
  actions.current = { onRefresh, onBack };
  const busy = useRef(false);

  useEffect(() => {
    setView(IDLE);
    if (!enabled || !isIPadStandalonePwa()) return;
    let alive = true;
    let gesture: Gesture | null = null;
    let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => {
      gesture = null;
      if (!busy.current) setView(IDLE);
    };
    const start = (event: TouchEvent) => {
      cancel();
      if (busy.current || event.defaultPrevented || event.touches.length !== 1 || !gestureTarget(event.target)) return;
      if (window.visualViewport && window.visualViewport.scale !== 1) return;
      const touch = event.touches[0];
      const edge = touch.clientX <= EDGE_WIDTH && window.history.length > 1;
      const top = pageAtTop();
      if (!top && !edge) return;
      // Own only this installed-app edge start, so WebKit cannot also navigate on release.
      if (edge) {
        if (!event.cancelable) return;
        event.preventDefault();
      }
      clearTimeout(feedbackTimer);
      setView(IDLE);
      gesture = { identifier: touch.identifier, x: touch.clientX, y: touch.clientY, top, edge, direction: 'pending', distance: 0 };
    };
    const move = (event: TouchEvent) => {
      if (!gesture) return;
      if (event.touches.length !== 1 || hasOpenLayer() || event.defaultPrevented) { cancel(); return; }
      const touch = Array.from(event.touches).find(item => item.identifier === gesture?.identifier);
      if (!touch || !event.cancelable) { cancel(); return; }
      const dx = touch.clientX - gesture.x, dy = touch.clientY - gesture.y;
      if (gesture.direction === 'pending') {
        // Stop the browser's hard reload before it owns the downward drag.
        if (gesture.top && dy > 0 && dy > Math.abs(dx)) event.preventDefault();
        if (Math.max(Math.abs(dx), Math.abs(dy)) < SLOP) return;
        if (gesture.edge && dx > Math.abs(dy) * 1.5) gesture.direction = 'back';
        else if (gesture.top && pageAtTop() && dy > Math.abs(dx) * 1.5) gesture.direction = 'refresh';
        else { cancel(); return; }
      }
      event.preventDefault();
      if (gesture.direction === 'refresh') {
        // Resistance follows the finger, with a soft cap beyond the release threshold.
        gesture.distance = Math.min(112, Math.max(0, dy) * 0.5);
        setView({ kind: 'pull', distance: gesture.distance });
      } else {
        gesture.distance = Math.min(160, Math.max(0, dx));
        setView({ kind: 'back', distance: gesture.distance });
      }
    };
    const finish = (event: TouchEvent) => {
      const completed = gesture;
      if (!completed) return;
      gesture = null;
      if (event.touches.length || hasOpenLayer() || !Array.from(event.changedTouches).some(touch => touch.identifier === completed.identifier)) { cancel(); return; }
      if (completed.direction === 'back' && completed.distance >= BACK_THRESHOLD) {
        setView(IDLE);
        actions.current.onBack();
        return;
      }
      if (completed.direction !== 'refresh' || completed.distance < PULL_THRESHOLD) { cancel(); return; }
      busy.current = true;
      setView({ kind: 'refreshing', distance: PULL_THRESHOLD });
      const deadline = new Promise<never>((_, reject) => {
        refreshTimer = setTimeout(() => reject(new Error('Refresh timed out')), REFRESH_TIMEOUT_MS);
      });
      void Promise.race([Promise.resolve().then(() => actions.current.onRefresh()), deadline])
        .then(() => { if (alive) setView(IDLE); })
        .catch(() => {
          if (!alive) return;
          setView({ kind: 'error', distance: PULL_THRESHOLD });
          feedbackTimer = setTimeout(() => { if (alive) setView(IDLE); }, 4000);
        })
        .finally(() => { busy.current = false; clearTimeout(refreshTimer); });
    };
    document.addEventListener('touchstart', start, { passive: false });
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', finish, { passive: true });
    document.addEventListener('touchcancel', cancel, { passive: true });
    window.addEventListener('pagehide', cancel);
    return () => {
      alive = false;
      clearTimeout(feedbackTimer);
      // Keep the read's deadline alive: navigation must not leave the shared busy lock stuck.
      document.removeEventListener('touchstart', start);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', finish);
      document.removeEventListener('touchcancel', cancel);
      window.removeEventListener('pagehide', cancel);
    };
  }, [routeKey, enabled]);

  return view;
}
