// Bundle processing for a transplant case: run each provider document through the
// per-claim pipeline, look up provider/category by NPI (reference data), then roll
// up billed charges grand total + per-provider + per-category, and reconcile
// against the contracted case rate.
import fs from "node:fs/promises";
import path from "node:path";
import { process as processClaim } from "./pipeline.js";
import { buildClaimModel } from "./claim.js";

const CASE_RATE = 410000; // contracted transplant bundle amount (demo)

function rollup(documents, keyFn) {
  const map = new Map();
  for (const d of documents) {
    const k = keyFn(d);
    const cur = map.get(k) || { key: k, charge: 0, count: 0 };
    cur.charge += d.charge;
    cur.count += 1;
    map.set(k, cur);
  }
  return [...map.values()].sort((a, b) => b.charge - a.charge);
}

export async function processBundle(dir) {
  const ref = JSON.parse(await fs.readFile(path.join(dir, "reference.json"), "utf8"));
  const files = (await fs.readdir(dir))
    .filter((f) => f.endsWith(".pdf") && f !== "combined.pdf")
    .sort();

  const documents = [];
  for (const file of files) {
    const slug = file.replace(/\.pdf$/, "");
    const ocr = await processClaim(path.join(dir, file));
    const model = buildClaimModel(slug, ocr);
    const npiField = model.fields?.box33_billing_npi;
    const npi = npiField?.value || "";
    const lookup = ref[npi] || { provider: "Unknown provider", category: "Unclassified", formType: "?" };
    documents.push({
      slug,
      formType: lookup.formType,
      provider: lookup.provider,
      category: lookup.category,
      npi,
      npiValid: npiField?.valid ?? null,
      patient: model.fields?.box2_patient_name?.value || "",
      charge: model.totalCharge ?? 0,
      needsReview: model.needsReview || [],
      tokens: model.tokenUsage?.total ?? 0,
      cost: model.tokenUsage?.cost ?? null,
      image: `/api/bundle/image/${slug}`,
    });
  }

  const tokenCost = { haiku: 0, sonnet: 0 };
  for (const d of documents) {
    if (d.cost) {
      tokenCost.haiku += d.cost.haiku.pipeline;
      tokenCost.sonnet += d.cost.sonnet.pipeline;
    }
  }

  const grandTotal = documents.reduce((s, d) => s + d.charge, 0);
  return {
    documentCount: documents.length,
    grandTotal,
    caseRate: CASE_RATE,
    variance: grandTotal - CASE_RATE, // + = billed over case rate
    byProvider: rollup(documents, (d) => d.provider),
    byCategory: rollup(documents, (d) => d.category),
    tokenTotal: documents.reduce((s, d) => s + d.tokens, 0),
    tokenCost,
    reviewCount: documents.filter((d) => d.needsReview.length > 0).length,
    documents,
  };
}
