// Bundle processing for a transplant case: run each provider document through the
// per-claim pipeline, look up provider/category by NPI (reference data), then roll
// up billed charges grand total + per-provider + per-category, and reconcile
// against the contracted case rate.
import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { process as processClaim } from "./pipeline.js";
import { buildClaimModel } from "./claim.js";

const CASE_RATE = 410000; // contracted transplant bundle amount (demo)
const UPLOAD_ROOT = "uploads";

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

// Core: extract + look up + aggregate for a list of documents.
//   docs: [{ slug, path, image }]   reference: { npi -> {provider, category, formType} }
async function processDocs(docs, reference) {
  const documents = [];
  for (const doc of docs) {
    const ocr = await processClaim(doc.path);
    const model = buildClaimModel(doc.slug, ocr);
    const npiField = model.fields?.box33_billing_npi;
    const npi = npiField?.value || "";
    const lookup = reference[npi] || { provider: "Unknown provider", category: "Unclassified", formType: "?" };
    documents.push({
      slug: doc.slug,
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
      image: doc.image,
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

// Sample bundle: read the generated bundle/ directory.
export async function processBundle(dir) {
  const reference = JSON.parse(await fs.readFile(path.join(dir, "reference.json"), "utf8"));
  const files = (await fs.readdir(dir))
    .filter((f) => f.endsWith(".pdf") && f !== "combined.pdf")
    .sort();
  const docs = files.map((f) => {
    const slug = f.replace(/\.pdf$/, "");
    return { slug, path: path.join(dir, f), image: `/api/bundle/image/${slug}` };
  });
  return processDocs(docs, reference);
}

// Uploaded bundle: accept many PDFs (one doc each) OR a combined multi-page PDF
// (split into one document per page). Reference lookups reuse the known providers
// in bundle/reference.json; unknown NPIs fall through to "Unknown / Unclassified".
export async function processUploadedFiles(uploadId, files) {
  const dir = path.join(UPLOAD_ROOT, uploadId);
  await fs.mkdir(dir, { recursive: true });

  const docs = [];
  let n = 0;
  for (const f of files) {
    const src = await PDFDocument.load(f.buffer);
    const pageCount = src.getPageCount();
    const pages = pageCount > 1 ? [...Array(pageCount).keys()] : [0];
    for (const p of pages) {
      const out = await PDFDocument.create();
      const [pg] = await out.copyPages(src, [p]);
      out.addPage(pg);
      const slug = `doc-${++n}`;
      await fs.writeFile(path.join(dir, `${slug}.pdf`), Buffer.from(await out.save()));
      docs.push({ slug, path: path.join(dir, `${slug}.pdf`), image: `/api/upload/image/${uploadId}/${slug}` });
    }
  }

  let reference = {};
  try {
    reference = JSON.parse(await fs.readFile(path.join("bundle", "reference.json"), "utf8"));
  } catch {
    /* no reference available — everything resolves to Unknown */
  }

  const result = await processDocs(docs, reference);
  result.uploaded = true;
  result.uploadId = uploadId;
  return result;
}
