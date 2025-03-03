# Prompt Structure

This directory contains all the prompts used for AI interactions in the application.

## Directory Structure

```
frontend/app/config/prompts/
├── system/             # System prompts for different AI functions
│   ├── thought.ts      # System prompt for thought generation
│   ├── insights.ts     # System prompt for sermon insights
│   └── ...
├── user/               # User message templates for different AI functions
│   ├── thoughtTemplate.ts      # User message template for thought generation
│   ├── insightsTemplate.ts     # User message template for sermon insights
│   └── ...
└── index.ts            # Exports all prompts for easy import
```

## How to Use

Import the necessary prompts into your OpenAI client file:

```typescript
import { 
  thoughtSystemPrompt, 
  createThoughtUserMessage 
} from "@/config/prompts";

// Then use them in your API calls
const response = await openai.chat.completions.create({
  model: gptModel,
  messages: [
    { role: "system", content: thoughtSystemPrompt },
    { role: "user", content: createThoughtUserMessage(params) },
  ]
});
```

## Adding New Prompts

1. Create a new file in the appropriate directory (system/ or user/)
2. Export the prompt or template function
3. Add the export to index.ts
4. Import and use in your client code

## Best Practices

- Keep system prompts focused on the specific task
- User message templates should have clear parameters
- Document the purpose of each prompt at the top of the file
- Use consistent naming: `[feature]SystemPrompt` for system prompts and `create[Feature]UserMessage` for user templates 