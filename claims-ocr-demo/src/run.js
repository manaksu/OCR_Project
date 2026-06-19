// Entry point: OCR each sample, then run deterministic validation, and print a
// combined report. `needs_review` = union of low-confidence flags AND validation
// failures -- showing that the two layers catch different errors.
import { process as processClaim } from "./pipeline.js";
import { validateFields } from "./validate.js";

const samples = [
  "samples/good_scan.pdf",
  "samples/small_scan.pdf",
  "samples/digital.pdf",
];

for (const s of samples) {
  try {
    const ocr = await processClaim(s);
    const report = { source: s, method: ocr.method };

    if (ocr.fields && Object.keys(ocr.fields).length) {
      const validation = validateFields(ocr.fields);
      const review = new Set(ocr.review); // low-confidence flags from OCR
      report.fields = {};
      for (const [k, f] of Object.entries(ocr.fields)) {
        const v = validation[k] ?? { valid: null, issues: [] };
        if (v.valid === false) review.add(k); // add validation failures
        report.fields[k] = {
          value: f.value,
          confidence: f.confidence,
          valid: v.valid,
          issues: v.issues,
        };
      }
      report.needs_review = [...review];
    } else {
      report.raw_text = ocr.raw_text; // text-layer path, no OCR/validation
    }

    console.log("\n=== " + s + " ===");
    console.log(JSON.stringify(report, null, 2));
  } catch (e) {
    console.error("FAILED on " + s + ":", e);
    process.exitCode = 1; // Node global
  }
}
