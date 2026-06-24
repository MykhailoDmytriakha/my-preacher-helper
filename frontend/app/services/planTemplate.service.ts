import { PlanTemplate, SermonOutline } from '@/models/models';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE;

// Strangler-fig flag: when ON, plan-template reads/writes go through the client
// Firestore SDK (offline replica + deployed Security Rules) instead of the
// /api/plan-templates server route. Default OFF — identical to the server path.
const clientActive = () =>
  process.env.NEXT_PUBLIC_USE_CLIENT_PLAN_TEMPLATES === 'true' && typeof window !== 'undefined';

export interface CreatePlanTemplatePayload {
  id: string;
  userId: string;
  name: string;
  structure: SermonOutline;
}

export type UpdatePlanTemplatePayload = Partial<Pick<PlanTemplate, 'name' | 'structure'>>;

// NOTE: writes intentionally do NOT pre-check connectivity — offline the fetch
// rejects (or the client SDK queues) and React Query buffers + replays.

export const getPlanTemplates = async (userId: string): Promise<PlanTemplate[]> => {
  if (clientActive()) {
    const { getPlanTemplatesViaClient } = await import('./planTemplates.client');
    return getPlanTemplatesViaClient(userId);
  }
  const res = await fetch(`${API_BASE}/api/plan-templates?userId=${userId}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch plan templates');
  return res.json();
};

export const createPlanTemplate = async (payload: CreatePlanTemplatePayload): Promise<PlanTemplate> => {
  if (clientActive()) {
    const { createPlanTemplateViaClient } = await import('./planTemplates.client');
    return createPlanTemplateViaClient(payload);
  }
  const res = await fetch(`${API_BASE}/api/plan-templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to create plan template');
  return res.json();
};

export const updatePlanTemplate = async (
  id: string,
  updates: UpdatePlanTemplatePayload
): Promise<void> => {
  if (clientActive()) {
    const { updatePlanTemplateViaClient } = await import('./planTemplates.client');
    await updatePlanTemplateViaClient(id, updates);
    return;
  }
  const res = await fetch(`${API_BASE}/api/plan-templates`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...updates }),
  });
  if (!res.ok) throw new Error('Failed to update plan template');
};

export const deletePlanTemplate = async (id: string): Promise<void> => {
  if (clientActive()) {
    const { deletePlanTemplateViaClient } = await import('./planTemplates.client');
    await deletePlanTemplateViaClient(id);
    return;
  }
  const res = await fetch(`${API_BASE}/api/plan-templates?id=${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete plan template');
};
