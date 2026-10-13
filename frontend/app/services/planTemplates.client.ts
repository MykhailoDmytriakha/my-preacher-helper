import { PlanTemplate, SermonOutline } from '@/models/models';

/**
 * Plan templates are written only through the data engine (engineOwnedCollections.ts): the hook
 * `usePlanTemplates` reads the engine collection and commits through the engine editor. What stays
 * here is the shape the screens share with it.
 */

/** A template's name and structure are edited together by one person. */
export const PLAN_TEMPLATE_AGGREGATE = 'template';

export interface CreatePlanTemplatePayload {
  id: string;
  userId: string;
  name: string;
  structure: SermonOutline;
}

export type UpdatePlanTemplatePayload = Partial<Pick<PlanTemplate, 'name' | 'structure'>>;
