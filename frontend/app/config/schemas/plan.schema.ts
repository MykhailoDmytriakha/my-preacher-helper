export const planFunctionSchema = {
  function: {
    name: "generatePlan",
    description: "Generate a plan for a specific section of a sermon in the same language as the sermon content",
    parameters: {
      type: "object",
      properties: {
        outline: {
          type: "string",
          description: "An outline for the sermon section, formatted as a structured text with bullet points, headers, and clear organization. Must be in the same language as the input sermon content."
        }
      },
      required: ["outline"]
    }
  }
}; 