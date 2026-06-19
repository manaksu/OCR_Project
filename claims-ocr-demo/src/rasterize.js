// Rasterize a PDF page to a PNG buffer using a SINGLE pdfjs + @napi-rs/canvas.
// In Node, pdfjs runs on the main thread (no worker), so there is no API/worker
// version mismatch -- which is what broke pdf-to-png-converter (two pdfjs copies).
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// pdfjs renders the 14 standard fonts from its own glyph data (not system fonts)
export const STANDARD_FONTS =
  path.join(__dirname, "..", "node_modules", "pdfjs-dist", "standard_fonts") + path.sep;

class NodeCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
    return { canvas, context: canvas.getContext("2d") };
  }
  reset(cc, width, height) {
    cc.canvas.width = Math.ceil(width);
    cc.canvas.height = Math.ceil(height);
  }
  destroy(cc) {
    cc.canvas.width = 0;
    cc.canvas.height = 0;
    cc.canvas = null;
    cc.context = null;
  }
}

// Rasterize page 1 of a PDF (file path or bytes) to a PNG Buffer at `scale`.
export async function rasterizePdf(input, scale) {
  const data =
    typeof input === "string" ? new Uint8Array(await fs.readFile(input)) : new Uint8Array(input);
  const factory = new NodeCanvasFactory();
  const doc = await pdfjs.getDocument({
    data,
    isEvalSupported: false,
    standardFontDataUrl: STANDARD_FONTS,
    canvasFactory: factory,
  }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale });
  const { canvas, context } = factory.create(viewport.width, viewport.height);
  await page.render({ canvasContext: context, viewport, canvasFactory: factory }).promise;
  const png = canvas.toBuffer("image/png");
  await doc.destroy();
  return png;
}
