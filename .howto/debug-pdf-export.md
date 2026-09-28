when: PDF export text is image · PDF text not selectable · cannot copy or search text in exported PDF · blurry PDF export · PDF bottom cut off · long sermon shrunk into one page · pdftotext · pdfimages · pdffonts · ExportPdfModal · handleExportPdf · html2canvas · jsPDF · Save as PDF · экспорт в PDF · текст в PDF картинкой · нельзя выделить текст в PDF · размытый PDF · обрезан низ PDF · проповедь сжата в одну страницу · печать

# Debug the PDF export

Before changing rendering logic, find out what the exported file actually is: `pdftotext file.pdf -` shows whether it has a text layer, `pdfimages -list file.pdf` shows the images in it, `pdffonts file.pdf` the fonts. The current export in `frontend/app/components/export-buttons/ExportPdfModal.tsx` is a raster by design: `html2canvas` (scale 2) paints the preview into a PNG and `jsPDF` places that one image on one A4 page.

## How

- `pdftotext` prints nothing and `pdfimages -list` shows one image → the file is a picture, as built. Selectable text needs a different renderer, not a styling fix.
- `pdffonts` lists fonts and `pdftotext` returns the words → it is a text PDF; look at text rendering instead.
- `handleExportPdf` scales the canvas by `Math.min(pageWidth / imageWidth, pageHeight / imageHeight)` and places it 30 mm from the top. Long content is shrunk onto the single page, not split across pages; when the height decides the scale, the image is a full page tall but starts 30 mm down, so its bottom 30 mm fall off the page.
- `html2canvas` and `jspdf` load lazily on the first export click.

## Why

- 2026-02-01: no rendering tweak gives a raster file a text layer, so the file type decides whether a rendering change can help at all; one command tells which case you are in.
