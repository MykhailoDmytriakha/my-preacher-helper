when: useState(prop) keeps old value · modal shows stale data · prop arrives after mount · form shows empty field then never fills · React Query refetch does not reach the form · optimistic update overwrites typed text · rollback wipes the draft · dirty ref · formEditedRef · seriesTouchedRef · sync local state with props · reset state when entity changes · key remount · устаревшие данные в модалке · пропс пришёл позже · поле пустое и не заполняется · состояние из пропса · сбросить состояние при смене сущности · откат стирает черновик · форма не видит обновление

# Sync local state from a prop that arrives late

`useState(prop)` reads the prop once, on the first render; a later value (a React Query refetch, a list that finishes loading after the modal opened, an optimistic cache write) never reaches the state. Pair it with a `useEffect` that copies the prop in, guarded by a "the person has edited" ref, as `frontend/app/components/EditSermonModal.tsx` does.

## How

- Keep `useState(prop)` for the first paint, then add `useEffect(() => { if (editedRef.current) return; setX(prop.x); }, [prop])`. Set the ref in every change handler (`markEdited` sets `formEditedRef.current = true`), never in the effect.
- The guard is the point, not a detail: once the person has typed, the form holds the only copy of the draft. Optimistic cache updates and their rollback both replace the prop object while the modal is open, and without the guard they overwrite the typed text (comment on the effect in `EditSermonModal.tsx`).
- A single field can skip the effect entirely: derive it during render until it is touched — `const shown = touchedRef.current ? localValue : valueFromProp` (`seriesTouchedRef` in `EditSermonModal.tsx`). The field follows the loading list and stops following the moment the person picks something.
- When the whole entity changes (another id), do not sync field by field — remount with a `key`: `SermonOutline` renders its editor with `key={`${userId}:${id}`}` so every `useState` starts fresh (`frontend/app/components/sermon/SermonOutline.tsx`).

## Traps

- The save compares against the value the form opened with → do not re-sync that baseline from the prop. A focus refetch replaces the prop without the form being reopened; the baseline would then equal the server and every stale write would look clean. Freeze it per id instead (`openedWithRef` in `EditSermonModal.tsx`).
- A field that should stay empty until data arrives shows `""` and offers a wrong action (for example "unfile from series") → it was frozen at the pre-load value; derive it from the prop until touched.

## Why

- 2026-02-24: a modal opened before its React Query data refetched kept showing the stale cached value, because `useState(prop)` initialises once.
- 2026-08-14: the dirty-ref guard was needed on the edit-sermon form because optimistic writes and their rollback replaced `sermon` under a mounted form and erased what the person had typed.

See also: `.howto/fix-effect-dependencies.md`
