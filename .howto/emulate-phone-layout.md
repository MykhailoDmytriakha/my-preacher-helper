when: phone layout · tablet layout · narrow viewport · emulate device width · window will not get narrow · resize_window does nothing · window.innerWidth stuck at 820 · Chrome window stops near 500px · Toggle device toolbar · Cmd+Shift+M · responsive check · breakpoint band · sm md lg · useWideViewport · useRoomyHeader · button missing on tablet · вёрстка на телефоне · вид на планшете · узкий экран · эмуляция устройства · окно не сужается · проверка адаптивности · адаптив · режим устройства в DevTools

# Emulate a phone or tablet layout

Resizing the Chrome window does not reach phone width. Use DevTools device emulation, "Toggle device toolbar" (the phone-and-tablet icon left of the Elements tab, Cmd+Shift+M): it gives a true 375 px viewport, the right device pixel ratio and touch emulation. Then visit every breakpoint band the code branches on, not only the two ends.

## How

- Trust `window.innerWidth`, not the tool's success message. `resize_window` and AppleScript both report success while Chrome stays at its minimum, roughly 500 CSS px, or 820 on a scaled display.
- When Chrome is driven by an agent tool, the device toolbar has to be switched on by the owner by hand; ask for it.
- Read the breakpoints out of the code first. The note page branches in JS on `useWideViewport` (`(min-width: 1024px)`, Tailwind `lg`) and `useRoomyHeader` (`(min-width: 640px)`, `sm`), both in `frontend/app/hooks/useWideViewport.ts` and used by `frontend/app/(pages)/(private)/studies/[id]/page.tsx`; add the `sm:` / `md:` / `lg:` prefixes of the markup you touch.
- N breakpoints make N+1 states. Check one width inside every band, e.g. 390, 800 and 1280 for the note page.
- In each band ask: is every control that opens something present in the same band as the thing it opens?

## Why

- 2026-09-02: phone measurements were taken at 500 px instead of 390, and the 640–1023 px band was never rendered. It held a P0: below `lg` the note's properties moved into a bottom sheet, but the button that opens the sheet existed only below `sm`, so on a tablet the outline, tags, references and dates were mounted with nothing able to reach them. Every gate was green.

See also: `.howto/detect-viewport-safely.md` · `.howto/fix-clipped-or-misaligned-layout.md`
