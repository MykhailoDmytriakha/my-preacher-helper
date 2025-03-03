/**
 * Schema for the item sorting function call.
 * This defines the expected structure for AI-generated sort orders.
 */
export const sortingFunctionSchema = {
  type: "function",
  function: {
    name: "sortItems",
    description: "Sort sermon items into a logical sequence based on outline structure",
    parameters: {
      type: "object",
      properties: {
        sortedItems: {
          type: "array",
          items: {
            type: "object",
            properties: {
              key: { 
                type: "string",
                description: "The first 4 characters of the item ID"
              },
              outlinePoint: { 
                type: "string",
                description: "The outline point this item belongs to"
              },
              content: { 
                type: "string",
                description: "A brief preview of the item content"
              }
            },
            required: ["key"]
          }
        }
      },
      required: ["sortedItems"]
    }
  }
}; 