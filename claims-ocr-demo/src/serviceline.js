// Parse a service line by PATTERN, not token position. OCR can merge/split tokens
// (e.g. POS+CPT running together) or drop the ICD decimal, so positional parsing
// is fragile. Matching by shape keeps the billed CHARGE correct even when other
// tokens are mangled -- what matters most for a billed-charges roll-up.
export function parseServiceLine(value) {
  const tokens = (value || "").trim().split(/\s+/);
  const money = tokens.filter((t) => /^\d+\.\d{2}$/.test(t));

  // ICD-10: prefer a dotted code; else a dot-less one (OCR often drops the period).
  let icd =
    tokens.find((t) => /^[A-Za-z]\d{2}(\.\d+)?$/.test(t)) ||
    tokens.find((t) => /^[A-Za-z]\d{3,}$/.test(t)) ||
    "";
  // The ICD-10-CM decimal is positional (after the 3rd char) -> reinsert it.
  if (/^[A-Za-z]\d{3,}$/.test(icd)) icd = icd.slice(0, 3) + "." + icd.slice(3);

  return {
    pos: tokens.find((t) => /^\d{2}$/.test(t)) || tokens[0] || "",
    cpt: tokens.find((t) => /^\d{5}$/.test(t)) || "",
    icd,
    charge: money.length ? money[money.length - 1] : "",
    units: tokens[tokens.length - 1] || "",
  };
}
