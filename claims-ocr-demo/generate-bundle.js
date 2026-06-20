// Generate a sample TRANSPLANT BUNDLE: several provider documents (each an
// image-only "scan"), plus reference.json (NPI -> provider/category) and a
// combined.pdf (all docs concatenated, for the form-type-change splitter later).
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fs from "node:fs/promises";
import path from "node:path";
import { rasterizePdf } from "./src/rasterize.js";
import { ZONES, PAGE_W_PT, PAGE_H_PT } from "./src/template.js";

const H = PAGE_H_PT;
const PATIENT = "DOE, JANE T"; // one transplant case -> same patient on every doc
const MEMBER = "TRX99887766";

// One billed document per provider in the transplant case.
const PROVIDERS = [
  { slug: "1-facility",   first9: "111111111", formType: "UB-04",    provider: "University Transplant Center",     category: "Facility",          cpt: "99214", icd: "E11.9", charge: "285000.00" },
  { slug: "2-surgeon",    first9: "222222222", formType: "CMS-1500", provider: "A. Carrel MD, Transplant Surgery", category: "Professional",      cpt: "99215", icd: "E11.9", charge: "42000.00" },
  { slug: "3-anesthesia", first9: "333333333", formType: "CMS-1500", provider: "Metro Anesthesia Associates",      category: "Professional",      cpt: "00300", icd: "E11.9", charge: "8800.00" },
  { slug: "4-organ",      first9: "444444444", formType: "UB-04",    provider: "Regional Organ Procurement Org",   category: "Organ Acquisition", cpt: "99204", icd: "E11.9", charge: "95000.00" },
  { slug: "5-labs",       first9: "555555555", formType: "CMS-1500", provider: "Citywide Reference Labs",          category: "Labs",              cpt: "99212", icd: "E11.9", charge: "3200.00" },
];

// Append the NPI check digit (Luhn over "80840" + first 9) so each NPI validates.
function npiFromFirst9(first9) {
  const base = "80840" + first9;
  let sum = 0;
  for (let i = 0; i < base.length; i++) {
    let d = Number(base[base.length - 1 - i]);
    if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return first9 + String((10 - (sum % 10)) % 10);
}

async function buildDocPdf(spec, npi) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE_W_PT, PAGE_H_PT]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const drawTop = (text, x, topY, size) =>
    page.drawText(text, { x, y: H - topY, size, font, color: rgb(0, 0, 0) });

  drawTop(`${spec.formType}   ${spec.provider}`, PAGE_W_PT * 0.06, PAGE_H_PT * 0.05, 11);
  const values = {
    box1a_insured_id: MEMBER,
    box2_patient_name: PATIENT,
    box24_service_ln: `11    ${spec.cpt}    ${spec.icd}    ${spec.charge}    1`,
    box33_billing_npi: npi,
  };
  for (const [name, z] of Object.entries(ZONES)) {
    const [x0, y0, x1, y1] = z.rect;
    page.drawRectangle({
      x: x0 * PAGE_W_PT, y: H - y1 * PAGE_H_PT,
      width: (x1 - x0) * PAGE_W_PT, height: (y1 - y0) * PAGE_H_PT,
      borderColor: rgb(0, 0, 0), borderWidth: 0.7,
    });
    drawTop(name, x0 * PAGE_W_PT + 2, y0 * PAGE_H_PT - 2, 5);
    drawTop(values[name], x0 * PAGE_W_PT + 4, y0 * PAGE_H_PT + 12, 9);
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

async function main() {
  const outDir = path.resolve("bundle");
  await fs.mkdir(outDir, { recursive: true });

  const reference = {};
  const scanPdfs = [];
  for (const spec of PROVIDERS) {
    const npi = npiFromFirst9(spec.first9);
    reference[npi] = { provider: spec.provider, category: spec.category, formType: spec.formType };
    const vector = await buildDocPdf(spec, npi);
    const png = await rasterizePdf(vector, 4.0); // hi-res so NPIs/charges read cleanly
    const scan = await wrapImageAsPdf(png);
    await fs.writeFile(path.join(outDir, `${spec.slug}.pdf`), scan);
    scanPdfs.push(scan);
  }

  await fs.writeFile(path.join(outDir, "reference.json"), JSON.stringify(reference, null, 2));

  // combined.pdf: all documents concatenated (one page each) for the splitter
  const combined = await PDFDocument.create();
  for (const buf of scanPdfs) {
    const src = await PDFDocument.load(buf);
    const [pg] = await combined.copyPages(src, [0]);
    combined.addPage(pg);
  }
  await fs.writeFile(path.join(outDir, "combined.pdf"), Buffer.from(await combined.save()));

  console.log(`Bundle: ${PROVIDERS.length} docs + reference.json + combined.pdf in ${outDir}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
