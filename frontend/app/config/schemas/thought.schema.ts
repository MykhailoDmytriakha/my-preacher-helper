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
        originalText: {
          type: "string",
          description: "The original transcription text provided as input"
        },
        formattedText: {
          type: "string",
          description: "The processed and formatted thought text derived from the original input"
        },
        tags: {
          type: "array",
          items: {
            type: "string"
          },
          description: "List of relevant tags for the thought"
        },
        meaningPreserved: {
          type: "boolean",
          description: "Whether the generated text accurately reflects the core meaning of the original transcription"
        }
      },
      required: ["originalText", "formattedText", "tags", "meaningPreserved"]
    }
  }
}; 