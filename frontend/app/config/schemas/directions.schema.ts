/**
 * Schema for the sermon directions function call.
 * This defines the expected structure for AI-generated sermon direction suggestions.
 */
export const directionsFunctionSchema = {
  type: "function",
  function: {
    name: "generateSermonDirections",
    description: "Generate suggestions for sermon direction and improvement",
    parameters: {
      type: "object",
      properties: {
        directions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { 
                type: "string",
                description: "The title of the direction suggestion"
              },
              description: { 
                type: "string",
                description: "Detailed explanation of the suggestion"
              },
              examples: {
                type: "array",
                items: {
                  type: "string"
                },
                description: "Examples or specific applications of this suggestion"
              }
            },
            required: ["title", "description"]
          }
        }
      },
      required: ["directions"]
    }
  }
}; 