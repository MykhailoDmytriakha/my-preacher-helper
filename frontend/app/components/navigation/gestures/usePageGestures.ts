'use client';

import { useEffect, useRef, useState } from 'react';

import { recordDiagnostic } from '@/utils/appDiagnostics';
import { isIPadStandalonePwa } from '@/utils/pwaEnv';

import { gestureBlockReason, hasOpenLayer, pageAtTop } from './touchTargets';

export const PULL_THRESHOLD = 72;
export const BACK_THRESHOLD = 90;
/** How long the page takes to slide away before the previous one is shown. */
export const LEAVE_MS = 200;
/** How long an abandoned swipe takes to glide home. */
export const SETTLE_MS = 250;
/**
 * A quick flick goes back without travelling the threshold, and a flick back to the left cancels
 * past it, as in Safari. Speed is pixels per millisecond over the last moments before release.
 */
const FLICK_SPEED = 0.6;
const FLICK_MIN = 32;
const SPEED_WINDOW_MS = 50;
/**
 * Going back reports itself: a same-document step with popstate, another document with pagehide.
 * Silence this long means there was nothing behind this page, so it glides home.
 */
const LEAVE_GIVE_UP_MS = 1500;
/**
 * The left edge belongs to Safari: an installed app keeps the system's swipe back there, which
 * slides the real previous page in. No gesture of ours starts in it, not even a pull.
 */
const EDGE_WIDTH = 28;
const SLOP = 8;
const MAX_PULL = 140;
const RELOAD_START_TIMEOUT_MS = 5000;
const CLICKABLE = 'a, button, label, [role="button"]';

type Sample = { x: number; at: number };
type Gesture = {
  identifier: number;
  x: number;
  y: number;
  target: Element;
  top: boolean;
  canGoBack: boolean;
  direction: 'pending' | 'refresh' | 'back';
  distance: number;
  /** Where a page caught while gliding home already stood, so it continues from there. */
  baseline: number;
  /** Finger positions as touch events reported them, the release point last. */
  samples: Sample[];
};
/**
 * What the page surface shows. `pull` and `back` follow the finger; `leaving` slides the page away
 * before going back; `settling` glides an abandoned swipe home before the surface lets go.
 */
export type GestureView = {
  kind: 'idle' | 'pull' | 'back' | 'leaving' | 'settling' | 'refreshing' | 'error';
  distance: number;
};
export type PageOffset = { x: number; y: number };
const IDLE: GestureView = { kind: 'idle', distance: 0 };
const SETTLING: GestureView = { kind: 'settling', distance: 0 };
const REFRESHING: GestureView = { kind: 'refreshing', distance: PULL_THRESHOLD };

/**
 * Speed at release, the lift point last in `samples`. `recent` runs from the newest report at least a
 * window before the lift, at that report's own time: a sparse report can only make it slower, never a
 * flick. `last` is the final moving step; a lift that repeats the last report keeps that step, unless
 * the finger rested before lifting.
 */
export function releaseSpeeds(samples: Sample[]): { recent: number; last: number } {
  const release = samples[samples.length - 1];
  let from = samples[0];
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    if (release.at - samples[index].at >= SPEED_WINDOW_MS) { from = samples[index]; break; }
  }
  const moves = samples.slice(0, -1);
  const lastMove = moves[moves.length - 1] ?? release;
  const beforeMove = moves[moves.length - 2] ?? lastMove;
  const step = (to: Sample, start: Sample) => (to.x - start.x) / Math.max(16, to.at - start.at);
  const last = release.x !== lastMove.x ? step(release, lastMove)
    : release.at - lastMove.at > SPEED_WINDOW_MS ? 0 : step(lastMove, beforeMove);
  return { recent: step(release, from), last };
}

function prefersCalm(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
}

/** How far the page stands from home for this finger: one to one sideways, with resistance downwards. */
function travel(gesture: Gesture, clientX: number, clientY: number): number {
  return gesture.direction === 'refresh'
    ? Math.min(MAX_PULL, Math.max(0, gesture.baseline + (clientY - gesture.y) * 0.5))
    : Math.max(0, gesture.baseline + clientX - gesture.x);
}

export function usePageGestures({ routeKey, enabled, onRefresh, onBack, readOffset }: {
  routeKey: string;
  enabled: boolean;
  onRefresh: () => void;
  onBack: () => void;
  /** Where the page is drawn right now, mid-animation included. */
  readOffset?: () => PageOffset;
}) {
  const [view, setView] = useState<GestureView>(IDLE);
  const actions = useRef({ onRefresh, onBack, readOffset });
  actions.current = { onRefresh, onBack, readOffset };

  useEffect(() => {
    setView(IDLE);
    if (!enabled || !isIPadStandalonePwa()) return;
    recordDiagnostic('gesture', { source: 'setup', result: 'enabled', route: routeKey });
    let reloading = false;
    let gesture: Gesture | null = null;
    let shown: GestureView['kind'] = 'idle';
    let departedFrom: string | null = null;
    // Not the Navigation API's canGoBack: WebKit's does not count entries the router pushes (2026-10-03).
    // Instead a back that went nowhere marks this page at its history length, and the next swipe here is
    // not offered until history moves or grows.
    let deadEnd: number | null = null;
    let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
    let reloadTimer: ReturnType<typeof setTimeout> | undefined;
    let clickTimer: ReturnType<typeof setTimeout> | undefined;
    let motionTimer: ReturnType<typeof setTimeout> | undefined;
    let clickTarget: Element | null = null;
    const address = () => `${window.location.pathname}${window.location.search}`;
    const show = (next: GestureView) => { shown = next.kind; setView(next); };
    /** The page glides home from wherever the finger left it; a pending reload keeps its place. */
    const settle = () => {
      clearTimeout(motionTimer);
      departedFrom = null;
      if (reloading) { show(REFRESHING); return; }
      if (prefersCalm()) { show(IDLE); return; }
      show(SETTLING);
      motionTimer = setTimeout(() => show(IDLE), SETTLE_MS);
    };
    const cancel = (reason?: string) => {
      const abandoned = gesture;
      gesture = null;
      if (!abandoned) return;
      if (reason) recordDiagnostic('gesture', { source: abandoned.direction, result: 'cancelled', code: reason });
      // A touch that never took a direction moved nothing, so there is nothing to bring back.
      if (abandoned.direction !== 'pending') settle();
    };
    const leave = () => {
      recordDiagnostic('gesture', { source: 'back', result: 'released' });
      show({ kind: 'leaving', distance: window.innerWidth });
      motionTimer = setTimeout(() => {
        // Something opened over the page while it was leaving: stay, the person is busy there.
        if (hasOpenLayer()) { settle(); return; }
        departedFrom = address();
        actions.current.onBack();
        motionTimer = setTimeout(() => {
          deadEnd = window.history.length;
          recordDiagnostic('gesture', { source: 'back', result: 'failed', code: 'no-previous-page' });
          settle();
        }, LEAVE_GIVE_UP_MS);
      }, prefersCalm() ? 0 : LEAVE_MS);
    };
    const start = (event: TouchEvent) => {
      // The page is already on its way back: a stray touch neither pulls it into view nor presses anything.
      if (shown === 'leaving') { if (event.cancelable) event.preventDefault(); return; }
      cancel();
      clickTarget = null;
      clearTimeout(clickTimer);
      if (shown === 'error') { clearTimeout(feedbackTimer); show(IDLE); }
      if (event.defaultPrevented || event.touches.length !== 1) return;
      const touch = event.touches[0];
      if (touch.clientX <= EDGE_WIDTH) return;
      const canGoBack = window.history.length > 1 && deadEnd !== window.history.length;
      const top = pageAtTop() && !reloading;
      if (!top && !canGoBack) return;
      const blocked = gestureBlockReason(event.target)
        ?? (window.visualViewport && window.visualViewport.scale !== 1 ? 'zoomed' : null);
      if (blocked) { recordDiagnostic('gesture', { source: 'start', result: 'blocked', code: blocked }); return; }
      const target = event.target as Element;
      gesture = {
        identifier: touch.identifier, x: touch.clientX, y: touch.clientY, target, top, canGoBack,
        direction: 'pending', distance: 0, baseline: 0, samples: [{ x: touch.clientX, at: Date.now() }],
      };
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
        const offset = shown === 'settling' ? actions.current.readOffset?.() : undefined;
        if (offset) {
          // A page still gliding home on the other axis is left to finish; only its own axis can be caught.
          if ((gesture.direction === 'refresh' ? offset.x : offset.y) > 1) { gesture = null; return; }
          // The finger caught it: the page continues from where it is drawn now.
          clearTimeout(motionTimer);
          gesture.baseline = (gesture.direction === 'refresh' ? offset.y : offset.x) - travel(gesture, touch.clientX, touch.clientY);
        }
        clearTimeout(feedbackTimer); // a failure notice from before this touch must not end the drag
        clickTarget = gesture.target.closest(CLICKABLE);
        recordDiagnostic('gesture', { source: gesture.direction, result: 'tracking' });
      }
      event.preventDefault();
      const now = Date.now();
      // Keep the moments the release speed needs, plus the last report before them.
      const recent = gesture.samples.filter(sample => now - sample.at <= SPEED_WINDOW_MS);
      const before = gesture.samples.filter(sample => now - sample.at > SPEED_WINDOW_MS).pop();
      gesture.samples = [...(before ? [before] : []), ...recent, { x: touch.clientX, at: now }];
      gesture.distance = travel(gesture, touch.clientX, touch.clientY);
      show({ kind: gesture.direction === 'refresh' ? 'pull' : 'back', distance: gesture.distance });
    };
    const finish = (event: TouchEvent) => {
      clickTimer = setTimeout(() => { clickTarget = null; }, 700);
      const completed = gesture;
      if (!completed) return;
      const released = Array.from(event.changedTouches).find(touch => touch.identifier === completed.identifier);
      if (event.touches.length || hasOpenLayer() || !released) { cancel(); return; }
      gesture = null;
      if (completed.direction === 'pending') return;
      // The lift point is the last word on where the finger went.
      completed.samples.push({ x: released.clientX, at: Date.now() });
      completed.distance = travel(completed, released.clientX, released.clientY);
      if (completed.direction === 'back') {
        const speed = releaseSpeeds(completed.samples);
        const reversing = speed.recent <= -FLICK_SPEED || speed.last <= -FLICK_SPEED;
        const flicked = speed.recent >= FLICK_SPEED && completed.distance >= FLICK_MIN;
        if (!reversing && (flicked || completed.distance >= BACK_THRESHOLD)) leave(); else settle();
        return;
      }
      if (completed.distance < PULL_THRESHOLD || reloading) { settle(); return; }
      reloading = true;
      show(REFRESHING);
      const failed = (code: string) => {
        clearTimeout(reloadTimer);
        reloading = false;
        recordDiagnostic('gesture', { source: 'reload', result: 'failed', code });
        // A back under way keeps the screen. So does a finger moving the page: whichever way it lets go
        // ends in settle, a new reload or leave, now that nothing is reloading. A resting touch moved nothing.
        if (shown === 'leaving' || (gesture && gesture.direction !== 'pending')) return;
        show({ kind: 'error', distance: 0 });
        feedbackTimer = setTimeout(() => show(IDLE), 4000);
      };
      // The document reload starts now, exactly like the header button. Do not await data readers.
      recordDiagnostic('gesture', { source: 'reload', result: 'requested' });
      reloadTimer = setTimeout(() => failed('navigation-not-started'), RELOAD_START_TIMEOUT_MS);
      try { actions.current.onRefresh(); } catch { failed('reload-rejected'); }
    };
    const click = (event: MouseEvent) => {
      if (event.detail === 0) return;
      const swiped = clickTarget && event.target instanceof Node && clickTarget.contains(event.target);
      if (shown !== 'leaving' && !swiped) return;
      event.preventDefault(); event.stopPropagation();
      if (swiped) clickTarget = null;
    };
    const interrupted = () => cancel('touch-cancelled');
    // History moved. Kept the address (a fragment, a repeated entry): no new page is coming, glide home.
    // Changed it: the route change will reset the surface; glide home only if it never renders.
    const traversed = () => {
      deadEnd = null;
      if (departedFrom === null) return;
      clearTimeout(motionTimer);
      if (address() === departedFrom) { settle(); return; }
      departedFrom = null;
      motionTimer = setTimeout(settle, LEAVE_GIVE_UP_MS * 2);
    };
    // Leaving the document or returning from the back-forward cache shows the page at rest.
    const pageChanged = () => {
      reloading = false;
      gesture = null;
      departedFrom = null;
      deadEnd = null;
      clearTimeout(reloadTimer); clearTimeout(feedbackTimer); clearTimeout(motionTimer);
      show(IDLE);
    };
    document.addEventListener('touchstart', start, { passive: false });
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', finish, { passive: true });
    document.addEventListener('touchcancel', interrupted, { passive: true });
    document.addEventListener('click', click, true);
    window.addEventListener('popstate', traversed);
    window.addEventListener('pagehide', pageChanged);
    window.addEventListener('pageshow', pageChanged);
    return () => {
      clearTimeout(feedbackTimer); clearTimeout(reloadTimer); clearTimeout(clickTimer); clearTimeout(motionTimer);
      document.removeEventListener('touchstart', start);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', finish);
      document.removeEventListener('touchcancel', interrupted);
      document.removeEventListener('click', click, true);
      window.removeEventListener('popstate', traversed);
      window.removeEventListener('pagehide', pageChanged);
      window.removeEventListener('pageshow', pageChanged);
    };
  }, [routeKey, enabled]);

  return view;
}
