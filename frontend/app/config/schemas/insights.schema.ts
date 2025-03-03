/**
 * Schema for the sermon insights function call.
 * This defines the expected structure for AI-generated sermon insights.
 */
export const insightsFunctionSchema = {
  type: "function",
  function: {
    name: "generateSermonInsights",
    description: "Generate meaningful insights from a sermon",
    parameters: {
      type: "object",
      properties: {
        mainIdea: {
          type: "string",
          description: "The main idea or theme of the sermon"
        },
        keyPoints: {
          type: "array",
          items: {
            type: "string"
          },
          description: "List of key points from the sermon"
        },
        suggestedOutline: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              description: { type: "string" }
            },
            required: ["id", "title"]
          },
          description: "Suggested outline structure for the sermon"
        },
        audienceTakeaways: {
          type: "array",
          items: {
            type: "string"
          },
          description: "What the audience should take away from the sermon"
        }
      },
      required: ["mainIdea", "keyPoints", "suggestedOutline", "audienceTakeaways"]
    }
  }
}; 