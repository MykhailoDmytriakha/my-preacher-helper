/**
 * Schema for the sermon verses function call.
 * This defines the expected structure for AI-generated verse suggestions.
 */
export const versesFunctionSchema = {
  type: "function",
  function: {
    name: "generateSermonVerses",
    description: "Generate scripture references relevant to a sermon",
    parameters: {
      type: "object",
      properties: {
        verses: {
          type: "array",
          items: {
            type: "object",
            properties: {
              reference: { 
                type: "string",
                description: "The Bible verse reference (Book Chapter:Verse)"
              },
              relevance: { 
                type: "string",
                description: "Explanation of how this verse relates to the sermon"
              }
            },
            required: ["reference", "relevance"]
          }
        }
      },
      required: ["verses"]
    }
  }
}; 