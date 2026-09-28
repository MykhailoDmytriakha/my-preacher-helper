when: toggle switch · on/off switch · Switch component · role="switch" · aria-checked · settings toggle · SettingsToggleRow · switch thumb off-centre · translate-x-5 · w-11 rail · Headless UI switch · переключатель вкл выкл · тумблер · свитч · кружок переключателя не по центру · переключатель в строке настроек

# Draw a toggle switch

Use `Switch` from `frontend/app/components/ui/Switch.tsx`: `<Switch checked={on} onClick={toggle} aria-label={…} />`. A settings row with a title and a description is `SettingsToggleRow` (`frontend/app/components/settings/SettingsToggleRow.tsx`), which wires the names for you.

## How

- It is a native `<button role="switch" aria-checked>`: keyboard activation and `disabled` come from the button. It is not Headless UI's `Switch` component — only its dimensions follow Headless UI's canonical example.
- Geometry: rail `h-6 w-11` with `border-2 border-transparent`, thumb `h-5 w-5` moved by `translate-x-5` (on) / `translate-x-0` (off). The arithmetic is why these belong together: 44 px rail − 2 × 2 px border = 40 px = 20 px thumb + 20 px of travel.
- On is `bg-blue-600`, off `bg-gray-200 dark:bg-gray-600`; the thumb is `pointer-events-none`, so the click always reaches the button.
- Give it a name: `aria-label`, or `aria-labelledby` / `aria-describedby` pointing at the visible title and description (as `SettingsToggleRow` does).
- Current callers: `SettingsToggleRow` and the "include tags" switch in `ExportTxtModal`. Don't draw another one by hand.

## Why

- 2026-02-24: the rail/thumb/translate set was fixed from Headless UI's canonical switch.
- 2026-09-07: the settings switches and the export toggle were separate hand-drawn copies; they were unified into `Switch`.
