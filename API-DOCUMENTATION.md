# Preacher Helper API Documentation

This document provides a comprehensive guide to the API endpoints and services available in the My Preacher Helper application.

## Overview

The My Preacher Helper API is a REST API built with Next.js API routes. It provides endpoints for managing sermons, thoughts, outlines, tags, and user settings. All endpoints are located under the `/api` path.

## Base URL

```
${API_BASE}/api
```

Where `API_BASE` is defined in the environment configuration.

## Authentication

The API uses Firebase Authentication. Most endpoints require a valid Firebase Authentication token.

## Data Models

### Thought

```typescript
interface Thought {
  id: string;           // Unique identifier
  text: string;         // Content of the thought
  tags: string[];       // Array of tag names
  date: string;         // ISO 8601 date string
  outlinePointId?: string; // Optional reference to an outline point
}
```

### OutlinePoint

```typescript
interface OutlinePoint {
  id: string;           // Unique identifier
  text: string;         // Content of the outline point
}
```

### Outline

```typescript
interface Outline {
  introduction: OutlinePoint[]; // Introduction section points
  main: OutlinePoint[];         // Main section points
  conclusion: OutlinePoint[];   // Conclusion section points
}
```

### Structure

```typescript
interface Structure {
  introduction: string[]; // Introduction section content
  main: string[];         // Main section content
  conclusion: string[];   // Conclusion section content
  ambiguous: string[];    // Content that couldn't be categorized
}
```

### Insights

```typescript
interface Insights {
  topics: string[];                   // Main topics of the sermon
  relatedVerses: VerseWithRelevance[]; // Related Bible verses
  possibleDirections: DirectionSuggestion[]; // Suggested sermon directions
}

interface VerseWithRelevance {
  reference: string;    // Bible verse reference
  relevance: string;    // Description of relevance to the sermon
}

interface DirectionSuggestion {
  area: string;         // Area of the suggestion
  suggestion: string;   // Content of the suggestion
  id?: string;          // Optional unique identifier
}
```

### Sermon

```typescript
interface Sermon {
  id: string;           // Unique identifier
  title: string;        // Sermon title
  verse: string;        // Bible verse reference
  date: string;         // ISO 8601 date string
  thoughts: Thought[];  // Array of thoughts
  outline?: Outline;    // Optional sermon outline
  structure?: Structure; // Optional sermon structure
  userId: string;       // User ID of the sermon owner
  insights?: Insights;  // Optional sermon insights
}
```

### Tag

```typescript
interface Tag {
  id: string;           // Unique identifier
  userId: string;       // User ID of the tag owner
  name: string;         // Tag name
  color: string;        // Tag color (hex code)
  required: boolean;    // Whether the tag is required
}
```

### UserSettings

```typescript
interface UserSettings {
  id: string;           // Unique identifier
  userId: string;       // User ID of the settings owner
  language: string;     // User's preferred language
  // Other future user settings can be added here
}
```

## Endpoints

### Thoughts API

#### Create Audio Thought

Transcribes audio input and generates a thought.

- **URL**: `/api/thoughts`
- **Method**: `POST`
- **Content-Type**: `multipart/form-data`
- **Body**:
  - `audio`: Audio file (Blob/File)
  - `sermonId`: ID of the sermon to add the thought to

**Response**:
- **Success**: 200 OK
  ```json
  {
    "id": "string",
    "text": "string",
    "tags": ["string"],
    "date": "string"
  }
  ```
- **Error**: 400 Bad Request, 500 Internal Server Error

#### Create Manual Thought

Creates a thought from text input.

- **URL**: `/api/thoughts?manual=true`
- **Method**: `POST`
- **Content-Type**: `application/json`
- **Body**:
  ```json
  {
    "sermonId": "string",
    "thought": {
      "text": "string"
    }
  }
  ```

**Response**:
- **Success**: 200 OK
  ```json
  {
    "id": "string",
    "text": "string",
    "tags": [],
    "date": "string"
  }
  ```
- **Error**: 400 Bad Request, 500 Internal Server Error

#### Update Thought

Updates an existing thought.

- **URL**: `/api/thoughts`
- **Method**: `PUT`
- **Content-Type**: `application/json`
- **Body**:
  ```json
  {
    "sermonId": "string",
    "thought": {
      "id": "string",
      "text": "string",
      "tags": ["string"],
      "date": "string",
      "outlinePointId": "string" // Optional
    }
  }
  ```

**Response**:
- **Success**: 200 OK (Returns the updated thought)
- **Error**: 400 Bad Request, 404 Not Found, 500 Internal Server Error

#### Delete Thought

Deletes a thought from a sermon.

- **URL**: `/api/thoughts`
- **Method**: `DELETE`
- **Content-Type**: `application/json`
- **Body**:
  ```json
  {
    "sermonId": "string",
    "thought": {
      "id": "string",
      "text": "string",
      "tags": ["string"],
      "date": "string"
    }
  }
  ```

**Response**:
- **Success**: 200 OK
  ```json
  {
    "message": "Thought deleted successfully."
  }
  ```
- **Error**: 400 Bad Request, 500 Internal Server Error

### Sermons API

The Sermons API allows for management of sermon documents, including:
- Creating new sermons
- Fetching sermons
- Updating sermons
- Deleting sermons
- Managing sermon outlines

Endpoints include:
- `/api/sermons` (GET, POST, PUT, DELETE)
- `/api/sermons/[id]` (GET)
- `/api/sermons/outline` (for outline management)

### Tags API

The Tags API allows for management of custom and required tags for organizing thoughts.

### User API

The User API allows for management of user settings and preferences.

## Client Services

### Thought Service

```typescript
// Create a thought from audio recording
createAudioThought(audioBlob: Blob, sermonId: string): Promise<Thought>

// Create a thought manually from text
createManualThought(sermonId: string, thought: Thought): Promise<Thought>

// Update an existing thought
updateThought(sermonId: string, thought: Thought): Promise<Thought>

// Delete a thought
deleteThought(sermonId: string, thought: Thought): Promise<void>
```

### Sermon Service

Contains methods for sermon management:
- Creating sermons
- Fetching sermons
- Updating sermons
- Deleting sermons

### Structure Service

Contains methods for working with sermon structure.

### Insights Service

Contains methods for generating and managing sermon insights.

### Tag Service

Contains methods for managing custom and required tags.

### User Settings Service

Contains methods for managing user settings and preferences.

## Error Handling

All API endpoints return appropriate HTTP status codes and error messages in JSON format. Common errors include:

- 400 Bad Request: Missing or invalid parameters
- 404 Not Found: Resource not found
- 500 Internal Server Error: Server-side error

Example error response:
```json
{
  "error": "Error message describing the issue"
}
```

## Rate Limiting

The API currently does not implement rate limiting, but excessive requests may be throttled by the underlying Firebase services.

## Versions

The current API version is built into the route structure and does not require explicit versioning in the URL path.

---

This documentation provides a comprehensive overview of the My Preacher Helper API. For specific implementation details, please refer to the source code. 