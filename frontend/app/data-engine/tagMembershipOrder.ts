import { compareActionTime } from './actionClock';

import type { ActionTime } from './actionClock';

export type TagMembershipAction = {
  tag: string;
  before: boolean;
  after: boolean;
  observedRevision: number;
  time: ActionTime | null;
  predecessorOperationId?: string;
};

export type TagMembershipProof = {
  present: boolean;
  revision: number;
  operationId: string;
  time: ActionTime | null;
  causal: boolean;
};

type Decision = { kind: 'keep' | 'uncertain' }
  | { kind: 'stamp'; time: ActionTime | null; causal: boolean }
  | { kind: 'ordered'; incomingWins: boolean; incomingTime: ActionTime; storedTime: ActionTime };

export const MAX_INLINE_TAG_NAME_LENGTH = 256;

export const isTagMembershipName = (tag: unknown): tag is string => typeof tag === 'string' && tag.trim().length > 0;

export type TagMembershipWire<Action extends TagMembershipAction> = Omit<Action, 'tag'> &
  ({ tag: string; tagIndex?: never } | { tag?: never; tagIndex: number });

/** A long name is already in the side of the change where the tag is present. */
export function encodeTagMembershipAction<Action extends TagMembershipAction>(action: Action,
  presentTags: readonly string[] | undefined): TagMembershipWire<Action> | undefined {
  if (action.tag.length <= MAX_INLINE_TAG_NAME_LENGTH) return { ...action, tag: action.tag };
  const { tag, ...evidence } = action;
  const tagIndex = presentTags?.indexOf(tag) ?? -1;
  return tagIndex < 0 ? undefined : { ...evidence, tagIndex };
}

export function readTagMembershipName(raw: Record<string, unknown>, presentTags: readonly string[] | undefined): string | undefined {
  if (raw.tagIndex === undefined) return isTagMembershipName(raw.tag) ? raw.tag : undefined;
  if (raw.tag !== undefined || typeof raw.tagIndex !== 'number' || !Number.isSafeInteger(raw.tagIndex) || raw.tagIndex < 0) return undefined;
  const tag = presentTags?.[raw.tagIndex];
  return isTagMembershipName(tag) ? tag : undefined;
}

/** Compare decisions about one membership, including equal outcomes that came from different actions. */
export function decideTagMembership(action: TagMembershipAction, stored: boolean, proof: TagMembershipProof | undefined,
  revision: number, floor: number): Decision {
  const previous = proof?.present === stored && proof.revision <= revision ? proof : undefined;
  const unobserved = previous && previous.revision > action.observedRevision;
  const causal = unobserved && previous.causal && previous.operationId === action.predecessorOperationId && stored === action.before;
  if (!unobserved || causal) {
    if (!previous && action.observedRevision < Math.min(floor, revision) && stored !== action.after) return { kind: 'uncertain' };
    return stored === action.before ? { kind: 'stamp', time: action.time, causal: true } : { kind: 'keep' };
  }
  const timing = action.time && previous.time ? compareActionTime(action.time, previous.time) : 0;
  if (stored === action.after) {
    if (!timing) return { kind: 'stamp', time: null, causal: false };
    return timing > 0 ? { kind: 'stamp', time: action.time, causal: true } : { kind: 'keep' };
  }
  return timing && action.time && previous.time
    ? { kind: 'ordered', incomingWins: timing > 0, incomingTime: action.time, storedTime: previous.time }
    : { kind: 'uncertain' };
}
