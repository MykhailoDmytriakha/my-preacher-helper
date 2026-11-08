import { newClientId } from '@/utils/clientId';

import { type ActionTime, isClockTime } from './actionClock';

const MAX_ROUND_TRIP_MS = 1500;
const MAX_SAMPLE_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_WALL_DISAGREEMENT_MS = 50;
const DRIFT_FRACTION = 0.001;

type Reading = { elapsedMs: number; wallMs: number; originMs: number };
type Sample = { owner: string; start: Reading; end: Reading; serverMs: number };
type ActionClockProbe = { challenge: string; receive(owner: string, serverMs: number): void };

const readBrowser = (): Reading => ({
  elapsedMs: performance.now(), wallMs: Date.now(), originMs: performance.timeOrigin,
});

function continuousElapsed(start: Reading, end: Reading): number | null {
  const elapsed = end.elapsedMs - start.elapsedMs;
  const disagreement = Math.abs(end.wallMs - start.wallMs - elapsed);
  return Number.isFinite(elapsed) && elapsed >= 0 && end.originMs === start.originMs
    && disagreement <= MAX_WALL_DISAGREEMENT_MS ? elapsed : null;
}

export function createActionClock(read = readBrowser, challengeId = newClientId) {
  let sample: Sample | undefined;
  return {
    begin(): ActionClockProbe {
      const start = read();
      return {
        challenge: challengeId(),
        receive(owner, serverMs) {
          const end = read();
          const roundTrip = continuousElapsed(start, end);
          if (!isClockTime(serverMs) || roundTrip === null || roundTrip > MAX_ROUND_TRIP_MS) return;
          // A slower, earlier concurrent request must not replace a fresher sample.
          if (sample?.owner === owner && sample.end.originMs === start.originMs && sample.start.elapsedMs > start.elapsedMs) return;
          sample = { owner, start, end, serverMs };
        },
      };
    },
    capture(owner: string): ActionTime | undefined {
      if (!sample || sample.owner !== owner) return undefined;
      const now = read();
      const sinceSend = continuousElapsed(sample.start, now);
      const sinceReceive = continuousElapsed(sample.end, now);
      if (sinceSend === null || sinceReceive === null || sinceSend > MAX_SAMPLE_AGE_MS) {
        sample = undefined;
        return undefined;
      }
      // Firestore read the server clock somewhere between send and receive.
      // Allow for timestamp rounding, elapsed-clock drift and an uneven round trip.
      const observedDisagreement = Math.max(
        Math.abs(now.wallMs - sample.start.wallMs - sinceSend),
        Math.abs(now.wallMs - sample.end.wallMs - sinceReceive),
      );
      const margin = 2 + sinceSend * DRIFT_FRACTION + observedDisagreement;
      return {
        earliestMs: Math.floor(sample.serverMs + sinceReceive - margin),
        latestMs: Math.ceil(sample.serverMs + sinceSend + margin),
      };
    },
  };
}

export const actionClock = createActionClock();
