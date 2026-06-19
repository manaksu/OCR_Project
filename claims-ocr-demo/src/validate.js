// Deterministic validation -- the reliability tier that confidence scores can't provide.
// Catches errors a confident-but-wrong OCR read slips through (e.g. a misread CPT).
// In production the allowlists below would be real code-set tables (looked up via the
// MCP / query-builder against Teradata/Oracle); here they are small illustrative sets.

const CPT_ALLOW = new Set(["99211", "99212", "99213", "99214", "99215", "99203", "99204", "99205"]);
const ICD_ALLOW = new Set(["J20.9", "J20.6", "J06.9", "J18.9", "E11.9", "I10", "Z00.00"]);

// Standard NPI check-digit validation (Luhn over "80840" + first 9 digits).
export function isValidNpi(npi) {
  if (!/^\d{10}$/.test(npi)) return false;
  const base = "80840" + npi.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < base.length; i++) {
    let d = Number(base[base.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(npi[9]);
}

function parseServiceLine(value) {
  const t = (value || "").trim().split(/\s+/);
  return { pos: t[0], cpt: t[1], icd: t[2], charge: t[3], units: t[4] };
}

// Returns { fieldName: { valid, issues:[...] } } for each field in the table.
export function validateFields(fields) {
  const out = {};
  const add = (name, issues) => {
    out[name] = { valid: issues.length === 0, issues };
  };

  const npi = fields.box33_billing_npi?.value ?? "";
  add("box33_billing_npi", isValidNpi(npi) ? [] : [`invalid NPI '${npi}' (format or Luhn check digit)`]);

  const name = fields.box2_patient_name?.value ?? "";
  add("box2_patient_name", name.length > 0 ? [] : ["empty patient name"]);

  const id = (fields.box1a_insured_id?.value ?? "").replace(/\s/g, "");
  add("box1a_insured_id", /^[A-Za-z0-9]+$/.test(id) ? [] : [`non-alphanumeric insured id '${id}'`]);

  const sl = parseServiceLine(fields.box24_service_ln?.value);
  const issues = [];
  if (!CPT_ALLOW.has(sl.cpt)) issues.push(`CPT '${sl.cpt}' not in code set`);
  if (!ICD_ALLOW.has(sl.icd)) issues.push(`ICD-10 '${sl.icd}' not in code set`);
  if (!/^\d+(\.\d{1,2})?$/.test(sl.charge ?? "")) issues.push(`charge '${sl.charge}' not numeric`);
  add("box24_service_ln", issues);

  return out;
}
