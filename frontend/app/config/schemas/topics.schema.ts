/**
 * Schema for the sermon topics function call.
 * This defines the expected structure for AI-generated topics.
 */
export const topicsFunctionSchema = {
  type: "function",
  function: {
    name: "generateSermonTopics",
    description: "Generate relevant topics for a sermon",
    parameters: {
      type: "object",
      properties: {
        topics: {
          type: "array",
          items: {
            type: "string"
          },
          description: "List of topics relevant to the sermon"
        }
      },
      required: ["topics"]
    }
  }
}; 