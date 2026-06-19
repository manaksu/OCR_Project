// Core pipeline: PDF -> probe (skip OCR if text layer) -> rasterize ->
// zonal crop (sharp) -> Tesseract OCR (tesseract.js) -> field table + confidence.
// All local, zero LLM tokens. Low-confidence fields are flagged for review.
import fs from "node:fs/promises";
import sharp from "sharp";
import { createWorker } from "tesseract.js";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { rasterizePdf, STANDARD_FONTS } from "./rasterize.js";
import { estImageTokens } from "./tokens.js";
import { ZONES } from "./template.js";

const CONF_FLAG = 60; // below this avg confidence -> human-in-the-loop / vision fallback
const PSM = { box24_service_ln: "6" }; // 7 = single line (default), 6 = block

async function textLayer(pdfPath) {
  try {
    const data = new Uint8Array(await fs.readFile(pdfPath));
    const doc = await pdfjs.getDocument({ data, isEvalSupported: false, standardFontDataUrl: STANDARD_FONTS }).promise;
    const page = await doc.getPage(1);
    const tc = await page.getTextContent();
    return tc.items.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim();
  } catch {
    return ""; // treat as scanned
  }
}

export async function process(pdfPath) {
  const result = { source: pdfPath, method: null, fields: {}, review: [] };

  // Tier 0: skip OCR entirely if the PDF has a real text layer
  const text = await textLayer(pdfPath);
  if (text.length >= 40) {
    result.method = "text-layer (no OCR, 0 tokens)";
    result.raw_text = text;
    return result;
  }

  // Scanned: rasterize the page, then OCR each zone
  const png = await rasterizePdf(pdfPath, 3.0);
  const meta = await sharp(png).metadata();
  const W = meta.width;
  const Hh = meta.height;
  result.method = `tesseract.js zonal OCR (${W}x${Hh}px, 0 tokens)`;

  const worker = await createWorker("eng");
  for (const [name, z] of Object.entries(ZONES)) {
    const [x0, y0, x1, y1] = z.rect;
    const left = Math.max(0, Math.round(x0 * W));
    const top = Math.max(0, Math.round(y0 * Hh));
    const width = Math.min(W - left, Math.round((x1 - x0) * W));
    const height = Math.min(Hh - top, Math.round((y1 - y0) * Hh));
    const crop = await sharp(png).extract({ left, top, width, height }).grayscale().png().toBuffer();
    await worker.setParameters({ tessedit_pageseg_mode: PSM[name] || "7" });
    const { data } = await worker.recognize(crop);
    const value = (data.text || "").replace(/\s+/g, " ").trim();
    const confidence = Math.round((data.confidence || 0) * 10) / 10;
    // cropTokens = tokens if THIS box were escalated to a vision model
    result.fields[name] = { value, confidence, cropTokens: estImageTokens(width, height) };
    if (confidence < CONF_FLAG) result.review.push(name);
  }
  await worker.terminate();
  result.pageTokens = estImageTokens(W, Hh); // all-vision baseline (whole page)
  return result;
}
