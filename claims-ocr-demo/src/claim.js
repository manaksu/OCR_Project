// Build a UI-friendly claim model from the OCR result + validation:
// header fields, service lines with per-line charges, and a computed total.
import { validateFields } from "./validate.js";

export function buildClaimModel(name, ocr) {
  const model = { source: ocr.source, method: ocr.method, image: `/api/image/${name}` };

  // Text-layer path: no OCR, no field table -- just show the extracted text.
  if (!ocr.fields || !Object.keys(ocr.fields).length) {
    model.textLayer = true;
    model.rawText = ocr.raw_text ?? "";
    return model;
  }

  const validation = validateFields(ocr.fields);
  const review = new Set(ocr.review); // low-confidence flags
  const fields = {};
  for (const [k, f] of Object.entries(ocr.fields)) {
    const v = validation[k] ?? { valid: null, issues: [] };
    if (v.valid === false) review.add(k);
    fields[k] = { value: f.value, confidence: f.confidence, valid: v.valid, issues: v.issues };
  }

  // Parse the service line(s). Box 24 holds: POS CPT ICD CHARGE UNITS.
  // (One line in this demo; a real CMS-1500 has up to 6 rows -> array extends.)
  const tokens = (ocr.fields.box24_service_ln?.value || "").trim().split(/\s+/);
  const lineValidation = validation.box24_service_ln ?? { valid: null, issues: [] };
  const serviceLines = [
    {
      line: 1,
      pos: tokens[0] || "",
      cpt: tokens[1] || "",
      icd: tokens[2] || "",
      charge: Number.parseFloat(tokens[3]) || 0,
      units: tokens[4] || "",
      valid: lineValidation.valid,
      issues: lineValidation.issues,
    },
  ];
  const totalCharge = serviceLines.reduce((sum, l) => sum + l.charge, 0);

  return { ...model, fields, serviceLines, totalCharge, needsReview: [...review] };
}
