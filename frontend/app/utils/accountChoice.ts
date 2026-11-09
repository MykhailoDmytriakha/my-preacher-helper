import { useSyncExternalStore } from 'react';

import { deviceChoice, type DeviceChoice, type DeviceChoiceFound, type DeviceChoiceSaved } from '@/utils/deviceChoice';

import type { ReadingSettings } from '@/models/models';

/*
 * A CHOICE KEPT IN THE ACCOUNT (the owner, 2026-11-02: «берём аккаунт»): a reader's setting the person makes once and
 * finds on every device, after any reload or deploy. The iPad's own storage lost the trail's settings across a restart
 * (BUG-20261101-device-choice-stale-page-overwrites); the account does not.
 *
 * ONE TRUTH ON THE SCREEN. While the settings bridge is connected (`providers/UserSettingsProvider.tsx`), what a screen
 * shows is what the settings editor holds — its draft of the account's `reading` — and nothing else: no copy of the device
 * that could run ahead of the editor or lag behind it. Three reviews by Codex on 02.11 each found the two copies parting
 * somewhere new (another tab, a refused storage write, a version taken back, an account switched); the cure was to keep
 * one. A change is handed to the editor at once as the fields the person changed, laid on its copy of the part, and is
 * shown over that copy until the editor has it.
 *
 * What the device keeps: a copy of the account's part under the account's own name (`<key>@<owner>`), only to draw at once
 * while the editor opens, and taken away once the account is known to have no such part; and the record of the version
 * before this one (`<key>`), read and never written while the bridge is connected — the person's earlier choice. That record
 * is conservative (Codex's fourth review): it is shown, and goes up, only while no account has ever shown this device the
 * part — once one has, the record is superseded for good, so a version the person took from the server is never undone by
 * it. It goes up once, after the server has answered with none and a moment has passed, as no change over the account's
 * copy, and only after it is marked moved (`<key>:moved`) — a mark that cannot be written stops the move, so the record can
 * never go to a second account. A second device saving the same part in that same moment meets the move as a conflict the
 * engine asks about; nothing is lost silently.
 *
 * A part can be changed only while its state is known: the editor writes and keeps (not a copy for reading, device
 * storage answering), the server's copy of it is not waiting outside the editor, and either the editor holds the part or
 * the server has answered — and the editor holds `reading` itself, or nothing of `reading` waits from the server (an
 * absent parent created on both sides is one conflict, not two parts). Otherwise its controls are unavailable, as other
 * settings are (`useUserSettings` busy).
 *
 * Without the bridge (a test of a screen, the settings not on the engine) a choice stays on the device, as it did before.
 */
export type AccountPart = keyof ReadingSettings;
type Reading = Partial<Record<AccountPart, unknown>> | null;

/**
 * The changed fields are laid on the editor's current part. A missing part can inherit an actual earlier device copy.
 * Defaults shown by a control are not written as competing account choices.
 */
export type AccountWriter = (part: AccountPart, change: object, opening: object) => Promise<void>;

/** `unavailable` — the part cannot be changed now; nothing changed. */
export type AccountChoiceSaved = DeviceChoiceSaved | 'unavailable';

export interface AccountChoice<T extends object> extends Omit<DeviceChoice<T>, 'save'> {
  save(change: Partial<T>): AccountChoiceSaved;
  /** Whether the part can be changed now — its controls are unavailable while it cannot. */
  useWritable(): boolean;
}

/** A device's earlier choice waits this long after the server's answer, for the settings copy to take that answer. */
export const MOVE_UP_AFTER_MS = 2000;

type Entry = { changed: () => void; reset: () => void };

const entries = new Map<AccountPart, Entry>();
/** The editor's `reading` once heard (a cached copy counts); the server's newer copy waiting outside the editor. */
let heard = false;
let reading: Reading = null;
let waiting: Reading = null;
let answeredNow = false;
let ownerNow: string | null = null;
let writerNow: AccountWriter | null = null;
/** Settings bridges connected (`ReadingSettingsSync`); none — the choices stay on the device. */
let bridges = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const changed = () => {
  entries.forEach((entry) => entry.changed());
  listeners.forEach((listener) => listener());
};

const holds = (copy: Reading, part: AccountPart) => copy?.[part] !== undefined && copy?.[part] !== null;
const holdsAny = (copy: Reading) => Boolean(copy && Object.values(copy).some((value) => value !== undefined && value !== null));

/** Whether `part` can be changed now (see the rule above). */
function partWritable(part: AccountPart): boolean {
  if (bridges === 0) return true;
  if (!writerNow || !ownerNow || !heard) return false;
  // The server's copy waits outside the editor: creating the part, or `reading` itself, now would collide with it.
  if (holds(waiting, part) && !holds(reading, part)) return false;
  if (reading === null && holdsAny(waiting)) return false;
  return holds(reading, part) || answeredNow;
}

/** The bridge is here, for `owner`: from now the account decides. Returns its disconnection. */
export function connectAccount(owner: string): () => void {
  bridges += 1;
  ownerNow = owner;
  changed();
  return () => {
    bridges -= 1;
    heard = false;
    reading = null;
    waiting = null;
    answeredNow = false;
    ownerNow = null;
    changed();
  };
}

/** What the editor holds (a copy from the device counts), whether the server has answered, the server's copy waiting for it. */
export function setAccountReading(value: Reading | undefined, answered: boolean, waitingValue: Reading = null): void {
  heard = true;
  reading = value ?? null;
  waiting = waitingValue;
  answeredNow = answered;
  changed();
}

/** How to write to the account now; null — not writable (settings not ready, device storage silent, signed out). */
export function setAccountWriter(writer: AccountWriter | null): void {
  writerNow = writer;
  changed();
}

export function resetAccountChoicesForTests(): void {
  heard = false;
  reading = null;
  waiting = null;
  answeredNow = false;
  ownerNow = null;
  writerNow = null;
  bridges = 0;
  entries.forEach((entry) => entry.reset());
  listeners.forEach((listener) => listener());
}

export function accountChoice<T extends object>({ part, key, parse, fallback, onOtherTab, onFirstRead }: {
  /** Its place in the account's `reading`. */
  part: AccountPart;
  /** Its key on the device, as before — the record of the version before this one. */
  key: string;
  parse: (raw: string | null) => T;
  fallback: T;
  onOtherTab?: () => void;
  onFirstRead?: (found: DeviceChoiceFound) => void;
}): AccountChoice<T> {
  // The device's own choice: the screens' store with no bridge, and the earlier record read while there is one.
  const device = deviceChoice<T>({ key, parse, fallback, onOtherTab, onFirstRead });
  const storage = <R>(work: (store: Storage) => R, failed: R): R => {
    try {
      return work(window.localStorage);
    } catch {
      return failed;
    }
  };
  const movedKey = `${key}:moved`;
  const cacheKey = (owner: string) => `${key}@${owner}`;
  // An account showed this device the part: the earlier record is superseded, even where storage refused the mark.
  let superseded = false;
  /** The record of the version before this one, unless it went up already or an account's part superseded it. */
  const earlier = (): T | null => {
    if (superseded || storage((store) => store.getItem(movedKey), null) !== null) return null;
    const raw = storage((store) => store.getItem(key), null);
    return raw === null ? null : parse(raw);
  };
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

  // Changes handed to the editor and not in its copy yet, for the account they went to: shown over its copy until the editor
  // publishes a new copy of the part — its own change or a version the person took (Codex, round 6) — or they settle.
  let pending: { owner: string; change: Partial<T>; count: number; part: string } | null = null;
  const partNow = () => JSON.stringify(reading?.[part] ?? null);
  let shown: T = fallback;
  let moveTimer: ReturnType<typeof setTimeout> | null = null;
  let moving = false;

  /** What the editor's side says, without the changes on their way. */
  const baseView = (): T => {
    const owner = ownerNow;
    if (heard && holds(reading, part)) return parse(JSON.stringify(reading?.[part]));
    if (heard) return earlier() ?? fallback;
    const cached = owner ? storage((store) => store.getItem(cacheKey(owner)), null) : null;
    return cached !== null ? parse(cached) : earlier() ?? fallback;
  };
  /** What the screen shows while the bridge is connected (see ONE TRUTH ON THE SCREEN). */
  const accountView = (): T => (pending && pending.owner === ownerNow ? { ...baseView(), ...pending.change } : baseView());

  const mayMoveUp = () => heard && answeredNow && Boolean(ownerNow && writerNow) && !holds(reading, part) && !holds(waiting, part)
    && !(reading === null && holdsAny(waiting)) && !moving && earlier() !== null;

  const moveUp = () => {
    moveTimer = null;
    const writer = writerNow, record = earlier();
    // Asked again now: the account may have gone away, or its part arrived meanwhile.
    if (!mayMoveUp() || !writer || !record) return;
    // Marked first: a record that cannot be marked moved does not move — it could go to a second account after this one.
    const marked = storage((store) => {
      store.setItem(movedKey, '1');
      return store.getItem(movedKey) === '1';
    }, false);
    if (!marked) return;
    moving = true;
    // Never unmarked: a refusal that comes late does not prove the account did not take it (Codex, round 5), and a record
    // that went up twice could go to a second account. Refused for real, the earlier choice is set once more by hand.
    const done = () => {
      moving = false;
      changed();
    };
    writer(part, {}, record).then(done, done);
  };

  const entry: Entry = {
    changed: () => {
      if (bridges === 0) return;
      // The editor published another copy of the part: it is the truth now, whatever was on its way.
      if (pending && (pending.owner !== ownerNow || pending.part !== partNow())) pending = null;
      const next = accountView();
      if (!same(next, shown)) shown = next;
      const owner = ownerNow;
      // The account's part, kept under the account's name for the next opening; the earlier record is superseded by it.
      if (heard && owner && holds(reading, part)) superseded = true;
      // Superseded is written down; where storage refuses the mark, the earlier record itself goes — the account holds the
      // choice now (Codex, round 6: a mark retried only on later changes never came).
      if (superseded && storage((store) => store.getItem(movedKey), null) === null) {
        const marked = storage((store) => {
          store.setItem(movedKey, '1');
          return true;
        }, false);
        if (!marked) storage((store) => store.removeItem(key), undefined);
      }
      if (heard && owner && holds(reading, part)) {
        const raw = JSON.stringify(reading?.[part]);
        if (storage((store) => store.getItem(cacheKey(owner)), null) !== raw) storage((store) => store.setItem(cacheKey(owner), raw), undefined);
      }
      // Known to have no such part (the server answered, nothing waits): the copy under its name is not drawn again.
      if (heard && owner && answeredNow && !holds(reading, part) && !holds(waiting, part)) {
        storage((store) => store.removeItem(cacheKey(owner)), undefined);
      }
      if (!moveTimer && mayMoveUp()) moveTimer = setTimeout(moveUp, MOVE_UP_AFTER_MS);
    },
    reset: () => {
      device.resetForTests();
      if (moveTimer) clearTimeout(moveTimer);
      moveTimer = null;
      moving = false;
      pending = null;
      shown = fallback;
      superseded = false;
    },
  };
  entries.set(part, entry);
  entry.changed();

  const read = (): T => (bridges === 0 ? device.read() : shown);

  return {
    read,
    // The newest is the editor's while the bridge is connected: another tab's record of the device never decides.
    readFresh: () => (bridges === 0 ? device.readFresh() : shown),
    save: (change) => {
      // No settings bridge: the choice stays on the device, as before the account kept it.
      if (bridges === 0) return device.save(change);
      const writer = writerNow, owner = ownerNow;
      if (!writer || !owner || !partWritable(part)) return 'unavailable';
      // Preserve a real earlier device choice when this account has no part. The view still supplies defaults locally.
      const before = holds(reading, part) ? shown : earlier() ?? {};
      pending = pending && pending.owner === owner
        ? { owner, change: { ...pending.change, ...change }, count: pending.count + 1, part: partNow() }
        : { owner, change, count: 1, part: partNow() };
      changed();
      const settle = () => {
        if (pending && pending.owner === owner) pending = pending.count > 1 ? { ...pending, count: pending.count - 1 } : null;
        changed();
      };
      // Settled either way: taken, the editor's copy carries it; refused, the editor's copy is what stays.
      writer(part, change, before).then(settle, settle);
      return 'kept';
    },
    useChoice: () => {
      // Both stores are always asked (one order of hooks), and the one that decides is read.
      const onDevice = device.useChoice();
      const inAccount = useSyncExternalStore(subscribe, read, () => fallback);
      return bridges === 0 ? onDevice : inAccount;
    },
    useWritable: () => useSyncExternalStore(subscribe, () => partWritable(part), () => false),
    resetForTests: entry.reset,
  };
}
