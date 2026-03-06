import { ExportButtonsLayout, ExportPdfModal, ExportTxtModal } from "@/components/export-buttons";
import { ExportButtonsLayout as DirectExportButtonsLayout } from "@/components/export-buttons/ExportButtonsLayout";
import { ExportPdfModal as DirectExportPdfModal } from "@/components/export-buttons/ExportPdfModal";
import { ExportTxtModal as DirectExportTxtModal } from "@/components/export-buttons/ExportTxtModal";

describe("export-buttons barrel", () => {
  it("re-exports the internal modules without changing their identities", () => {
    expect(ExportButtonsLayout).toBe(DirectExportButtonsLayout);
    expect(ExportPdfModal).toBe(DirectExportPdfModal);
    expect(ExportTxtModal).toBe(DirectExportTxtModal);
  });
});
