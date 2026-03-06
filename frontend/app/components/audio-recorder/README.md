# Audio Recorder Module Map

- `types.ts`
  Shared public and internal contracts for the recorder composition tree.
- `constants.ts`
  Stable translation keys, animation tokens, and responsive constants.
- `AudioRecorderControls.tsx`
  Pure presentational recorder UI leaves and the idle split button.
- `useResponsiveRecorderVariant.ts`
  Encapsulates mobile/desktop variant switching with `matchMedia` and resize fallback.
- `useAudioRecorderLifecycle.ts`
  Owns media recorder lifecycle, cleanup, timing, retry/error sync, and keyboard shortcuts.

`/frontend/app/components/AudioRecorder.tsx` stays the public entry point for callers. Add new recorder behavior inside this folder first unless the public prop contract must change.
