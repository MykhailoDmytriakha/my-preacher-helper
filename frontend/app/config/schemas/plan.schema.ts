/**
 * Schema for the sermon plan function call based on thoughts.
 * This defines the expected structure for AI-generated sermon plans.
 */
export const planFunctionSchema = {
  type: "function",
  function: {
    name: "generateSermonPlan",
    description: "Generate a suggested sermon plan by organizing existing thoughts into introduction, main part, and conclusion",
    parameters: {
      type: "object",
      properties: {
        introduction: {
          type: "string",
          description: "Suggested approach for the sermon introduction based on existing thoughts"
        },
        main: {
          type: "string", 
          description: "Suggested structure for the main part of the sermon based on existing thoughts"
        },
        conclusion: {
          type: "string",
          description: "Suggested approach for the sermon conclusion based on existing thoughts"
        }
      },
      required: ["introduction", "main", "conclusion"]
    }
  }
}; 