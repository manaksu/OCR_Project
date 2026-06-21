// Minimal X12 837P generator: maps a validated claim model -> 837 Professional
// segments. Envelope/payer/address values are placeholders (not on a CMS-1500);
// the claim-level data (provider NPI, subscriber, diagnosis, service line, charge)
// comes straight from the extracted + validated field table.
// NOTE: illustrative — a production 837 needs full ISA fixed-widths and SNIP edits.

function nameParts(full) {
  const [last = "", rest = ""] = (full || "").split(",").map((s) => s.trim());
  const t = rest.split(/\s+/).filter(Boolean);
  return { last: last || "UNKNOWN", first: t[0] || "", middle: t[1] || "" };
}
const noDot = (s) => (s || "").replace(".", ""); // X12 carries ICD-10 without the decimal

export function generate837P(claim, opts = {}) {
  const o = {
    submitterId: "SUBMITTER01", submitterName: "BILLING SERVICE", receiverId: "RECEIVER01",
    payerId: "PAYER001", payerName: "SAMPLE PAYER", date: "20260621", time: "1200",
    ctrl: "000000001", serviceDate: "20260615", claimId: "CLAIM0001", ...opts,
  };
  const f = claim.fields;
  const pn = nameParts(f.box2_patient_name?.value);
  const npi = f.box33_billing_npi?.value || "";
  const member = f.box1a_insured_id?.value || "";
  const sl = claim.serviceLines[0] || {};
  const total = (claim.totalCharge || 0).toFixed(2);

  const body = [];
  const S = (...p) => body.push(p.join("*"));

  S("ST", "837", "0001", "005010X222A1");
  S("BHT", "0019", "00", o.claimId, o.date, o.time, "CH");
  S("NM1", "41", "2", o.submitterName, "", "", "", "", "46", o.submitterId);  // 1000A submitter
  S("PER", "IC", "BILLING DEPT", "TE", "8005551212");
  S("NM1", "40", "2", o.payerName, "", "", "", "", "46", o.receiverId);       // 1000B receiver
  S("HL", "1", "", "20", "1");                                                // 2000A billing provider
  S("NM1", "85", "2", o.submitterName, "", "", "", "", "XX", npi);            // 2010AA provider + NPI
  S("N3", "123 PROVIDER WAY");
  S("N4", "ANYTOWN", "CA", "900010000");
  S("HL", "2", "1", "22", "0");                                               // 2000B subscriber
  S("SBR", "P", "18", "", "", "", "", "", "", "MC");
  S("NM1", "IL", "1", pn.last, pn.first, pn.middle, "", "", "MI", member);    // 2010BA subscriber
  S("NM1", "PR", "2", o.payerName, "", "", "", "", "PI", o.payerId);          // 2010BB payer
  S("CLM", o.claimId, total, "", "", `${sl.pos || "11"}:B:1`, "Y", "A", "Y", "Y"); // 2300 claim
  S("HI", `ABK:${noDot(sl.icd)}`);                                            // principal diagnosis
  S("LX", "1");                                                               // 2400 service line
  S("SV1", `HC:${sl.cpt}`, (sl.charge || 0).toFixed(2), "UN", String(sl.units || "1"), "", "", "1");
  S("DTP", "472", "D8", o.serviceDate);                                       // service date
  S("SE", String(body.length + 1), "0001");

  const isa = ["ISA", "00", "          ", "00", "          ", "ZZ", "SUBMITTERID    ",
    "ZZ", "RECEIVERID     ", o.date.slice(2), o.time, "^", "00501", o.ctrl, "0", "P", ":"].join("*");
  const gs = ["GS", "HC", o.submitterId, o.receiverId, o.date, o.time, "1", "X", "005010X222A1"].join("*");
  return [isa, gs, ...body, "GE*1*1", `IEA*1*${o.ctrl}`].map((s) => s + "~").join("\n");
}
