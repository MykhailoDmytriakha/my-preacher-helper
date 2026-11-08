import { createActionClock } from '../actionClock.client';

const serverMs = 1_800_000_000_000;

function fixture() {
  let elapsedMs = 0;
  let wallOffset = 5 * 60 * 60 * 1000;
  let originMs = 1;
  const clock = createActionClock(() => ({ elapsedMs, wallMs: elapsedMs + wallOffset, originMs }), () => 'probe');
  return {
    clock,
    advance: (ms: number) => { elapsedMs += ms; },
    jumpWall: (ms: number) => { wallOffset += ms; },
    resetOrigin: () => { originMs++; },
  };
}

it('bounds the action against the existing server read and ignores a fixed device clock offset', () => {
  const { clock, advance } = fixture();
  const probe = clock.begin();
  advance(120);
  probe.receive('owner', serverMs);
  advance(500);
  expect(clock.capture('owner')).toEqual({ earliestMs: serverMs + 497, latestMs: serverMs + 623 });
  expect(clock.capture('another-owner')).toBeUndefined();
});

it.each(['slow request', 'wall jump', 'elapsed origin reset', 'stale sample'])('abstains with a %s', condition => {
  const { clock, advance, jumpWall, resetOrigin } = fixture();
  const probe = clock.begin();
  advance(condition === 'slow request' ? 1600 : 100);
  probe.receive('owner', serverMs);
  if (condition === 'wall jump') jumpWall(-1000);
  if (condition === 'elapsed origin reset') resetOrigin();
  if (condition === 'stale sample') advance(25 * 60 * 60 * 1000);
  expect(clock.capture('owner')).toBeUndefined();
});

it('keeps a more recently sent probe when the first response arrives after it', () => {
  const { clock, advance } = fixture();
  const first = clock.begin();
  advance(200);
  const second = clock.begin();
  advance(100);
  second.receive('owner', serverMs + 200);
  advance(300);
  first.receive('owner', serverMs);
  expect(clock.capture('owner')).toEqual({ earliestMs: serverMs + 497, latestMs: serverMs + 603 });
});
