/**
 * Zod schema for section plan generation structured output.
 */
import { z } from "zod";

export const PlanSectionResponseSchema = z.object({
  introduction: z.string().describe("Generated outline content for introduction"),
  main: z.string().describe("Generated outline content for main section"),
  conclusion: z.string().describe("Generated outline content for conclusion"),
});

export type PlanSectionResponse = z.infer<typeof PlanSectionResponseSchema>;
