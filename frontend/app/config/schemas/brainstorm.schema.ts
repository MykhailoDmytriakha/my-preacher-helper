/**
 * Schema for the sermon brainstorm function call.
 * This defines the expected structure for AI-generated brainstorm suggestions.
 */
export const brainstormFunctionSchema = {
  type: "function",
  function: {
    name: "generateBrainstormSuggestion",
    description: "Generate a single brainstorm suggestion to help preacher overcome mental blocks",
    parameters: {
      type: "object",
      properties: {
        suggestion: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "The brainstorm suggestion text that encourages thinking"
            },
            type: {
              type: "string",
              enum: ["text", "question", "context", "reflection", "relationship", "application"],
              description: "The type of brainstorm suggestion"
            }
          },
          required: ["text", "type"]
        }
      },
      required: ["suggestion"]
    }
  }
}; 