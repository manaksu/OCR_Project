// Shared CMS-1500 zone template, in NORMALIZED (0-1) coordinates.
// Same template drives both sample generation and zonal cropping, so it is
// independent of page size / DPI -- a small scan and a large scan use the same numbers.

export const PAGE_W_PT = 612; // US Letter, PDF points (cosmetic page size)
export const PAGE_H_PT = 792;

// name -> { rect: [x0, y0, x1, y1] as fractions of the form, sample: value to print }
export const ZONES = {
  box1a_insured_id:  { rect: [0.60, 0.105, 0.97, 0.150], sample: "ABC123456789" },
  box2_patient_name: { rect: [0.03, 0.165, 0.49, 0.210], sample: "SMITH, JOHN A" },
  box24_service_ln:  { rect: [0.03, 0.540, 0.97, 0.595], sample: "11  99213  J20.9  150.00  1" },
  box33_billing_npi: { rect: [0.60, 0.900, 0.97, 0.945], sample: "1234567893" },
};
