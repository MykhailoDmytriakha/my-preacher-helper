# Column module map

This folder exists to keep `@/components/Column` readable for humans and AI agents.

- `Column.tsx`
  - Public entry point and composition root.
  - Keeps the existing caller API stable.
- `types.ts`
  - Shared prop and domain types for the Column feature.
- `constants.ts`
  - Shared string literals and UI constants.
- `utils.ts`
  - Pure mapping and styling helpers with no component state.
- `audio.ts`
  - Shared async audio-to-thought flows for section-level and outline-point recording.
- `useColumnOutlineState.ts`
  - Outline-point CRUD, debounced persistence, insertion, deletion, and generation.
- `DeletePointConfirmModal.tsx`
  - Standalone confirmation modal for outline-point deletion.

Rule of thumb:
- Add pure logic to `utils.ts`.
- Add stateful behavior to a hook.
- Keep `Column.tsx` focused on wiring and rendering.
