import { NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { SERVICE_ORDER_CATALOG } from '@/utils/serviceOrderCatalog';
import { serviceOrdersRepository } from '@repositories/serviceOrders.repository';


import type { ServiceOrder, ServiceOrderStep } from '@/models/models';

/**
 * THE RITES OVER ORDINARY HTTPS — the second road to the same database.
 *
 * The browser normally reads Firestore itself. On a device where that transport goes silent —
 * measured on the owner's iPad, zero server snapshots while this road answered in 205 ms — a
 * section with only one road shows a skeleton for ever. Every answer here is the caller's own:
 * the token is verified and the query filtered by it, because an admin key bypasses the
 * Security Rules that would otherwise say the same thing.
 */

const MAX_SEEDED_ORDERS = 40;
const MAX_STEPS_PER_ORDER = 60;
/**
 * Text is refused when it is too long, never shortened: a rite handed back with its words cut
 * is worse than a rite that was not created, because nothing says which words are gone.
 */
const MAX_TITLE = 200;
const MAX_SUMMARY = 400;
const MAX_STEP_BODY = 10000;
const MAX_REFS = 20;
const MAX_REF = 200;
/** The ten rites this route is for. Anything else is not a standard rite by definition. */
const CATALOG_KEYS = new Set<string>(SERVICE_ORDER_CATALOG);

function tooLong(candidate: Record<string, unknown>): boolean {
  if (typeof candidate.title === 'string' && candidate.title.length > MAX_TITLE) return true;
  if (typeof candidate.summary === 'string' && candidate.summary.length > MAX_SUMMARY) return true;
  const steps = Array.isArray(candidate.steps) ? candidate.steps : [];
  return steps.some((step) => {
    if (!step || typeof step !== 'object') return false;
    const entry = step as Record<string, unknown>;
    if (typeof entry.title === 'string' && entry.title.length > MAX_TITLE) return true;
    if (typeof entry.body === 'string' && entry.body.length > MAX_STEP_BODY) return true;
    const refs = Array.isArray(entry.scriptureRefs) ? entry.scriptureRefs : [];
    return refs.length > MAX_REFS || refs.some((ref) => typeof ref === 'string' && ref.length > MAX_REF);
  });
}

/**
 * A STEP IS ONLY THESE FIELDS. The payload comes from a browser, so it is a proposal, not a
 * document: anything else in it is dropped rather than stored, and a step without an id cannot
 * be addressed by later writes at all.
 */
function sanitizeSteps(value: unknown): ServiceOrderStep[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((step): step is Record<string, unknown> => Boolean(step) && typeof step === 'object')
    .filter((step) => typeof step.id === 'string' && step.id.length > 0)
    .slice(0, MAX_STEPS_PER_ORDER)
    .map((step) => ({
      id: step.id as string,
      title: typeof step.title === 'string' ? step.title : '',
      body: typeof step.body === 'string' ? step.body : '',
      scriptureRefs: Array.isArray(step.scriptureRefs)
        ? step.scriptureRefs.filter((ref): ref is string => typeof ref === 'string')
        : [],
      ...(step.flagged === true ? { flagged: true } : {}),
    }));
}

/** GET /api/service-orders — every rite belonging to the caller. */
export async function GET(request: Request) {
  try {
    const uid = await getRequiredAuthenticatedUid(request);
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const orders = await serviceOrdersRepository.listForOwner(uid);
    return NextResponse.json(orders, {
      // A rite read to prove what the server holds must never come from a cache in between.
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Error listing service orders:', error);
    return NextResponse.json({ error: 'Failed to list service orders' }, { status: 500 });
  }
}

/**
 * POST /api/service-orders — create the standard rites this caller does not have yet.
 *
 * The WORDS come from the client: they are the pastor's own language and live in the locale
 * files, which the server has no business duplicating. What the server owns is the decision —
 * whose rites these are, and which of them are missing.
 */
export async function POST(request: Request) {
  try {
    const uid = await getRequiredAuthenticatedUid(request);
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const payload = await request.json().catch(() => null);
    const orders = (payload as { orders?: unknown } | null)?.orders;
    if (!Array.isArray(orders) || orders.length === 0) {
      return NextResponse.json({ error: 'Missing required field: orders' }, { status: 400 });
    }
    if (orders.length > MAX_SEEDED_ORDERS) {
      return NextResponse.json({ error: 'Too many orders' }, { status: 413 });
    }

    const now = new Date().toISOString();
    const drafts: Omit<ServiceOrder, 'id'>[] = [];
    const seenKeys = new Set<string>();
    for (const candidate of orders as Record<string, unknown>[]) {
      /*
       * A rite without its own key cannot be told apart from one already stored, and "create
       * only what is missing" would quietly become "create again". The key must also be one of
       * the ten this route exists for: an invented key is not a standard rite, and it would go
       * on to be looked up by name in places that expect only these ten.
       */
      if (!candidate || typeof candidate.catalogKey !== 'string' || !CATALOG_KEYS.has(candidate.catalogKey)) {
        return NextResponse.json({ error: 'Every order needs a known catalogKey' }, { status: 400 });
      }
      if (seenKeys.has(candidate.catalogKey)) {
        return NextResponse.json({ error: 'Duplicate catalogKey in request' }, { status: 400 });
      }
      seenKeys.add(candidate.catalogKey);
      if (tooLong(candidate)) {
        return NextResponse.json({ error: 'Order text is too long' }, { status: 413 });
      }
      if (typeof candidate.title !== 'string' || !candidate.title.trim()) {
        return NextResponse.json({ error: 'Every order needs a title' }, { status: 400 });
      }
      drafts.push({
        userId: uid,
        catalogKey: candidate.catalogKey as ServiceOrder['catalogKey'],
        title: candidate.title.trim(),
        summary: typeof candidate.summary === 'string' ? candidate.summary : undefined,
        steps: sanitizeSteps(candidate.steps),
        rank: typeof candidate.rank === 'number' && Number.isFinite(candidate.rank) ? candidate.rank : 1000,
        createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : now,
        updatedAt: now,
      });
    }

    const stored = await serviceOrdersRepository.seedMissingForOwner(uid, drafts);
    return NextResponse.json(stored, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Error seeding service orders:', error);
    return NextResponse.json({ error: 'Failed to create service orders' }, { status: 500 });
  }
}
