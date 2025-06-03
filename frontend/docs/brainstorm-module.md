# Brainstorm Module Documentation

## Overview
The Brainstorm Module is an AI-powered feature designed to help preachers overcome creative blocks and mental stagnation during sermon preparation. It provides thoughtful suggestions that encourage thinking and exploration rather than providing ready-made content.

## Features
- **AI-Generated Suggestions**: Uses advanced AI to generate contextual brainstorming prompts
- **Multiple Suggestion Types**: Supports 6 different types of suggestions (text, question, context, reflection, relationship, application)
- **Multilingual Support**: Automatically responds in the same language as the sermon content (English, Russian, Ukrainian)
- **Minimalist Design**: Clean, intuitive interface with yellow lightbulb icon
- **Real-time Generation**: Instant suggestion generation with loading states

## Architecture

### Frontend Components
- **BrainstormModule.tsx**: Main React component with minimalist design
- **brainstorm.service.ts**: Service layer for API communication
- **Icons.tsx**: Contains the LightBulbIcon component

### Backend Components
- **API Route**: `/api/sermons/[id]/brainstorm` - POST endpoint for generating suggestions
- **AI Client**: `generateBrainstormSuggestion()` function in openAI.client.ts
- **Prompts**: System and user prompts optimized for brainstorming

### Data Models
```typescript
interface BrainstormSuggestion {
  id: string;
  text: string;
  type: 'text' | 'question' | 'context' | 'reflection' | 'relationship' | 'application';
}
```

## AI Prompting Strategy

### System Prompt Features
- Encourages thinking and momentum creation
- Focuses on sparking creativity rather than providing content
- Incorporates proven brainstorming techniques from preaching research
- Supports multiple suggestion types and approaches

### User Message Template
- Includes sermon context (title, verse, current content)
- Provides clear instructions for suggestion generation
- Emphasizes language matching for multilingual support
- Incorporates research-based brainstorming techniques

## Usage

### For Users
1. Navigate to a sermon page
2. Find the Brainstorm module (yellow lightbulb icon) after the audio recorder
3. Click "Generate" to get a thinking prompt
4. Use the suggestion to overcome creative blocks
5. Click "Another" to get a new suggestion

### For Developers
```typescript
// Generate a brainstorm suggestion
const suggestion = await generateBrainstormSuggestion(sermonId);

// Use in component
<BrainstormModule sermonId={sermon.id} />
```

## Localization
The module supports three languages with complete translations:
- **English**: `brainstorm.title`, `brainstorm.generateButton`, etc.
- **Russian**: Full translation set in `ru/translation.json`
- **Ukrainian**: Full translation set in `uk/translation.json`

## Research-Based Design
The brainstorm suggestions are based on research into overcoming "preacher's block" and incorporate proven techniques:
- Finding unexpected connections
- Exploring different angles and perspectives
- Identifying tension points and problems
- Discovering surprising elements
- Creating analogies and metaphors
- Encouraging momentum through starting points

## Error Handling
- Network errors are caught and displayed to users
- Loading states prevent multiple simultaneous requests
- Graceful fallbacks for AI generation failures
- Comprehensive error logging for debugging

## Performance Considerations
- Lightweight component with minimal re-renders
- Efficient API calls with proper error handling
- Optimized AI prompts for faster generation
- Minimal bundle size impact

## Future Enhancements
- Suggestion history and favorites
- Personalized suggestions based on preaching style
- Integration with sermon outline for context-aware suggestions
- Collaborative brainstorming features 