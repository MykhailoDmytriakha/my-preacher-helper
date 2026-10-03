/**
 * Zod schema for AI sorting structured output.
 */
import { z } from "zod";

export const SortedItemSchema = z.object({
  key: z.string().describe("The item's key exactly as shown in the input"),
  outlinePoint: z.string().optional().describe("Optional outline point text for assignment"),
  subPoint: z.string().optional().describe("Optional sub-point text within the outline point"),
  content: z.string().optional().describe("Optional content preview"),
});

export const SortingResponseSchema = z.object({
  sortedItems: z.array(SortedItemSchema).describe("Sorted list of items in desired order"),
});

export type SortedItemResponse = z.infer<typeof SortedItemSchema>;
export type SortingResponse = z.infer<typeof SortingResponseSchema>;
