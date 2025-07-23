/**
 * Schema for the sermon brainstorm function call.
 * This defines the expected structure for AI-generated brainstorm suggestions.
 */
export const brainstormFunctionSchema = {
  type: "function",
  function: {
    name: "generateBrainstormSuggestion",
    description: "Generate a single brainstorm suggestion to help preacher overcome mental blocks, with complexity matching sermon context richness",
    parameters: {
      type: "object",
      properties: {
        suggestion: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "The brainstorm suggestion text that encourages thinking, with complexity matching the sermon's contextual richness"
            },
            type: {
              type: "string",
              enum: ["text", "question", "context", "reflection", "relationship", "application", "synthesis", "multi-perspective"],
              description: "The type of brainstorm suggestion - synthesis and multi-perspective for rich contexts"
            },
            complexity: {
              type: "string",
              enum: ["basic", "moderate", "high", "multi-dimensional"],
              description: "The complexity level of the suggestion based on sermon context richness"
            },
            dimensions: {
              type: "array",
              items: {
                type: "string"
              },
              description: "Array of thinking dimensions or perspectives included in this suggestion (e.g., ['textual-analysis', 'contemporary-application', 'theological-depth'])"
            }
          },
          required: ["text", "type"]
        }
      },
      required: ["suggestion"]
    }
  }
}; 