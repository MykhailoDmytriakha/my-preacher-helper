/**
 * Schema for the thought function call.
 * This defines the expected structure for AI-generated thoughts.
 */
export const thoughtFunctionSchema = {
  type: "function",
  function: {
    name: "generateThought",
    description: "Generate a structured thought from a transcription with appropriate tags",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The processed thought text"
        },
        tags: {
          type: "array",
          items: {
            type: "string"
          },
          description: "List of relevant tags for the thought"
        }
      },
      required: ["text", "tags"]
    }
  }
}; 