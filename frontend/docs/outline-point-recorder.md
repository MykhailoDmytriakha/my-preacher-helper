Outline Point Mini Recorder
===========================

What it does
- Adds a tiny audio recorder button to every outline point header within each column (Introduction, Main, Conclusion).
- After recording and transcription, the created thought is automatically:
  - Tagged with the section (via localized tag names),
  - Linked to the specific outline point (`outlinePointId`),
  - Appended to the correct column in the UI under that point,
  - Persisted to Firestore through the existing `/api/thoughts` endpoint.

How it works
- UI: Implemented inside `app/components/Column.tsx` within `OutlinePointPlaceholder` using the existing `AudioRecorder` component (mini variant).
- Client service: `createAudioThoughtWithForceTag(...)` now accepts an optional `outlinePointId` and sends it in `FormData`.
- API: `app/api/thoughts/route.ts` reads `outlinePointId` and writes it onto the saved `Thought`.
- Page integration: `StructurePage`'s `handleAudioThoughtCreated` now preserves `outlinePointId` when constructing the UI `Item`.

Environment
- Uses the same OpenAI/Gemini configuration as the existing audio flow.
- Requires `OPENAI_API_KEY` and `OPENAI_AUDIO_MODEL` (or alternate provider settings already used in the project).

Usage
- Open Structure page, ensure a sermon and outline points exist.
- Click the mic icon on an outline point header and speak; recording auto-starts in the popover.
- On finish, the transcribed thought appears under that outline point.

Notes
- The main column-level mic remains for general notes not tied to a specific point.
- The recorder respects the 90s max duration set in `AudioRecorder`.
