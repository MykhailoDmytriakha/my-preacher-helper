import { PlanTemplate, SermonOutline } from '@/models/models';
import {
  createPlanTemplateViaClient,
  deletePlanTemplateViaClient,
  getPlanTemplatesViaClient,
  updatePlanTemplateViaClient,
} from '@/services/planTemplates.client';


// Plan templates live entirely on the client Firestore SDK (offline replica in
// IndexedDB + deployed Security Rules). The server fallback route was removed in
// the Phase 5 migration cleanup, so these are client-SDK-only by construction.

export interface CreatePlanTemplatePayload {
  id: string;
  userId: string;
  name: string;
  structure: SermonOutline;
}

export type UpdatePlanTemplatePayload = Partial<Pick<PlanTemplate, 'name' | 'structure'>>;

export const getPlanTemplates = (userId: string): Promise<PlanTemplate[]> =>
  getPlanTemplatesViaClient(userId);

export const createPlanTemplate = (payload: CreatePlanTemplatePayload): Promise<PlanTemplate> =>
  createPlanTemplateViaClient(payload);

export const updatePlanTemplate = (id: string, updates: UpdatePlanTemplatePayload): Promise<void> =>
  updatePlanTemplateViaClient(id, updates);

export const deletePlanTemplate = (id: string): Promise<void> => deletePlanTemplateViaClient(id);
