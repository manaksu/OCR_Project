// Generate sample claim-form PDFs in CI (no binaries committed):
//   digital.pdf    -> vector form WITH a text layer (pipeline skips OCR)
//   good_scan.pdf  -> hi-res image-only "scan" (legible)
//   small_scan.pdf -> lo-res image-only "scan" (under-resolution; OCR struggles)
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { pdfToPng } from "pdf-to-png-converter";
import fs from "node:fs/promises";
import path from "node:path";
import { ZONES, PAGE_W_PT, PAGE_H_PT } from "./template.js";

const H = PAGE_H_PT;

async function buildFormPdf() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE_W_PT, PAGE_H_PT]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  // draw with a top-origin helper (pdf-lib origin is bottom-left)
  const drawTop = (text, x, topY, size) =>
    page.drawText(text, { x, y: H - topY, size, font, color: rgb(0, 0, 0) });

  drawTop("HEALTH INSURANCE CLAIM FORM  (CMS-1500)", PAGE_W_PT * 0.2, PAGE_H_PT * 0.05, 11);
  for (const [name, z] of Object.entries(ZONES)) {
    const [x0, y0, x1, y1] = z.rect;
    page.drawRectangle({
      x: x0 * PAGE_W_PT,
      y: H - y1 * PAGE_H_PT,
      width: (x1 - x0) * PAGE_W_PT,
      height: (y1 - y0) * PAGE_H_PT,
      borderColor: rgb(0, 0, 0),
      borderWidth: 0.7,
    });
    drawTop(name, x0 * PAGE_W_PT + 2, y0 * PAGE_H_PT - 2, 5); // label above box
    drawTop(z.sample, x0 * PAGE_W_PT + 4, y0 * PAGE_H_PT + 12, 9); // value inside
  }
  return Buffer.from(await pdf.save());
}

async function wrapImageAsPdf(pngBuffer) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE_W_PT, PAGE_H_PT]);
  const img = await pdf.embedPng(pngBuffer);
  page.drawImage(img, { x: 0, y: 0, width: PAGE_W_PT, height: PAGE_H_PT });
  return Buffer.from(await pdf.save());
}

async function rasterize(pdfBuffer, viewportScale) {
  const pages = await pdfToPng(pdfBuffer, { viewportScale });
  return pages[0].content; // PNG buffer, in-memory
}

async function main() {
  const outDir = path.resolve("samples");
  await fs.mkdir(outDir, { recursive: true });

  const formPdf = await buildFormPdf();
  await fs.writeFile(path.join(outDir, "digital.pdf"), formPdf);

  const hi = await rasterize(formPdf, 4.0); // ~2448px wide
  await fs.writeFile(path.join(outDir, "good_scan.pdf"), await wrapImageAsPdf(hi));

  const lo = await rasterize(formPdf, 1.0); // ~612px wide (under-resolution)
  await fs.writeFile(path.join(outDir, "small_scan.pdf"), await wrapImageAsPdf(lo));

  const files = await fs.readdir(outDir);
  console.log("Generated samples:", files.join(", "));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
