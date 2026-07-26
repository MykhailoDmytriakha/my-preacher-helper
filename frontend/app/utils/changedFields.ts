/**
 * Which fields did the USER change?
 *
 * An editor must send only the fields the user touched. Sending everything means
 * an untouched field is written back from whatever snapshot this tab happens to
 * hold, silently reverting an edit made on another device.
 *
 * THE BASELINE IS THE POINT. It must be the value the editor OPENED WITH (then
 * whatever a save confirmed) — never the live cache. Diffing against the cache is
 * the intuitive choice and it destroys data:
 *
 *   Tab A renames a note. Tab B was opened earlier and still shows the old name.
 *   B refetches on focus, so B's CACHE now holds A's new name while B's INPUT
 *   still holds the old one. Against the cache, B's untouched title looks like a
 *   deliberate rename back — and B's next save overwrites A's edit.
 *
 * That was reproduced live on the study note editor (two tabs, title in one and
 * body in the other) before this baseline existed: the title edit was destroyed.
 * With the open-time baseline both edits survive.
 *
 * A field the user really did change stays different from the baseline until a
 * save carries it, so a failed write is simply re-sent on the next pass.
 */
export function changedFields<T extends object>(base: T | null | undefined, next: T): Partial<T> {
  const changed: Partial<T> = {};
  (Object.keys(next) as (keyof T)[]).forEach((key) => {
    // No baseline yet (document not loaded) means we cannot tell what the user
    // touched, so nothing is claimed as unchanged — send it all, as before.
    if (!base || JSON.stringify(base[key]) !== JSON.stringify(next[key])) {
      changed[key] = next[key];
    }
  });
  return changed;
}
