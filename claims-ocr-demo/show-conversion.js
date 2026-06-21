// Walk one claim through every conversion stage: raw OCR text -> structured ->
// validated -> X12 837P. Run:  node show-conversion.js
import { process as processClaim } from "./src/pipeline.js";
import { buildClaimModel } from "./src/claim.js";
import { generate837P } from "./src/x12.js";

const ocr = await processClaim("samples/good_scan.pdf");

console.log("\n=== 1. RAW OCR TEXT (what Tesseract handed back, per box) ===");
for (const [k, v] of Object.entries(ocr.fields)) {
  console.log(`  ${k.padEnd(20)} ${JSON.stringify(v.value)}  (conf ${v.confidence})`);
}

const claim = buildClaimModel("good_scan", ocr);
const sl = claim.serviceLines[0];

console.log("\n=== 2. STRUCTURED + VALIDATED (the conversion layer) ===");
console.log(`  patient        : ${claim.fields.box2_patient_name.value}  [valid ${claim.fields.box2_patient_name.valid}]`);
console.log(`  insured/member : ${claim.fields.box1a_insured_id.value}  [valid ${claim.fields.box1a_insured_id.valid}]`);
console.log(`  billing NPI    : ${claim.fields.box33_billing_npi.value}  [valid ${claim.fields.box33_billing_npi.valid} — Luhn check]`);
console.log(`  service line   : POS=${sl.pos} CPT=${sl.cpt} ICD=${sl.icd} charge=${sl.charge} units=${sl.units}  [valid ${sl.valid}]`);
console.log(`  total charge   : $${claim.totalCharge.toFixed(2)}`);
console.log(`  needs review   : ${claim.needsReview.length ? claim.needsReview.join(", ") : "none"}`);

console.log("\n=== 3. X12 837P (mapped from the validated field table) ===");
console.log(generate837P(claim));
console.log("");
