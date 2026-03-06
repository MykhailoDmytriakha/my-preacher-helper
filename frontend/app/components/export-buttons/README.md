# Export Buttons Module Map

- Public entry: `frontend/app/components/ExportButtons.tsx`
  - Keep this file as the stable caller boundary for `@/components/ExportButtons`.
- `frontend/app/components/export-buttons/ExportButtonsLayout.tsx`
  - Pure button surface for icon/text variants, tooltips, and orientation layout.
- `frontend/app/components/export-buttons/ExportTxtModal.tsx`
  - TXT/Markdown export modal, async content loading, tags toggle, copy, and download flows.
- `frontend/app/components/export-buttons/ExportPdfModal.tsx`
  - PDF preview/export modal with `html2canvas` + `jsPDF`.
- `frontend/app/components/export-buttons/TooltipStyles.tsx`
  - Shared global tooltip CSS for the export surface.
- `frontend/app/components/export-buttons/{constants,classNames,types}.ts`
  - Static contracts and pure helpers used by the extracted modules.

Edit rules:
- Change caller props only in `ExportButtons.tsx`.
- Change visual export-button behavior in `ExportButtonsLayout.tsx`.
- Change TXT/PDF modal behavior inside the respective modal module.
- Keep named exports `ExportTxtModal` and `ExportPdfModal` available from `ExportButtons.tsx` for tests and downstream imports.
