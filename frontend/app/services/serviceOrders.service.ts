/**
 * The one door the app uses to reach orders of service.
 *
 * Everything below it is the Firestore client module; keeping the façade means a page or a
 * hook never learns whether a write went straight to the device's Firestore, through the
 * guard, or into the offline outbox — and a later change of that answer touches one file.
 */
import {
  createServiceOrderViaClient,
  deleteServiceOrderViaClient,
  getAllServiceOrdersFromServerViaClient,
  getAllServiceOrdersViaClient,
  setServiceOrderRankViaClient,
  setServiceOrderRanksViaClient,
  updateServiceOrderMetaViaClient,
  updateServiceOrderStepsViaClient,
} from '@/services/serviceOrders.client';

import type { ServiceOrder, ServiceOrderStep } from '@/models/models';

export const getAllServiceOrders = (userId: string): Promise<ServiceOrder[]> =>
  getAllServiceOrdersViaClient(userId);

/** Refuses to answer from the cache: an absent rite here means the SERVER says it is absent. */
export const getAllServiceOrdersFromServer = (userId: string): Promise<ServiceOrder[]> =>
  getAllServiceOrdersFromServerViaClient(userId);

export const createServiceOrder = (order: Omit<ServiceOrder, 'id'>): Promise<ServiceOrder> =>
  createServiceOrderViaClient(order);

export const deleteServiceOrder = (id: string): Promise<void> => deleteServiceOrderViaClient(id);

export const setServiceOrderRank = (id: string, rank: number): Promise<void> =>
  setServiceOrderRankViaClient(id, rank);

/** All the ranks of a spread-out list, committed together or not at all. */
export const setServiceOrderRanks = (entries: { id: string; rank: number }[]): Promise<void> =>
  setServiceOrderRanksViaClient(entries);

export const updateServiceOrderMeta = (
  id: string,
  updates: Partial<Pick<ServiceOrder, 'title' | 'summary'>>,
  expectedRevision: number | null = null,
  expectedBaseline: Record<string, unknown> | null = null,
  userId?: string
): Promise<number | null> =>
  updateServiceOrderMetaViaClient(id, updates, expectedRevision, expectedBaseline, userId);

/** Resolves with the steps as they were COMMITTED, or null when the write changed nothing. */
export const updateServiceOrderSteps = (
  id: string,
  mutate: (steps: ServiceOrderStep[]) => ServiceOrderStep[] | null
): Promise<ServiceOrderStep[] | null> => updateServiceOrderStepsViaClient(id, mutate);
