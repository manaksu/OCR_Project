// Token accounting. The local pipeline costs ZERO tokens; the only place tokens
// can appear is an optional vision-model fallback on FLAGGED fields. We estimate
// that cost (and the "all-vision" baseline) so the savings are visible.

// Anthropic image-token estimate: ~ (w*h)/750, after resizing the long edge to
// <= 1568px, capped near 1600 tokens per image.
export function estImageTokens(w, h) {
  const MAX_EDGE = 1568;
  let W = w;
  let H = h;
  const longest = Math.max(W, H);
  if (longest > MAX_EDGE) {
    const s = MAX_EDGE / longest;
    W = Math.round(W * s);
    H = Math.round(H * s);
  }
  return Math.min(1600, Math.ceil((W * H) / 750));
}

// Build a per-stage token breakdown for one claim.
//   ocr        : pipeline result (fields carry cropTokens; result has pageTokens)
//   needsReview: field names escalated to a vision fallback
export function buildTokenUsage(ocr, needsReview = []) {
  const textLayer = !ocr.fields || !Object.keys(ocr.fields).length;

  const stages = [
    { stage: "Ingest / probe", tokens: 0, note: textLayer ? "text layer found" : "text-layer check (code)" },
    { stage: "Preprocess", tokens: 0, note: "crop / grayscale (CV)" },
    { stage: "OCR (Tesseract)", tokens: 0, note: textLayer ? "skipped — no OCR" : "local engine" },
    { stage: "Validation", tokens: 0, note: "NPI / CPT / ICD checks" },
  ];

  let fallback = 0;
  for (const name of needsReview) fallback += ocr.fields?.[name]?.cropTokens || 0;
  stages.push({
    stage: "Vision fallback",
    tokens: fallback,
    note: needsReview.length ? `${needsReview.length} flagged field(s) → VLM crop(s)` : "no fields flagged",
  });

  const baseline = ocr.pageTokens || 0; // all-vision: send the whole page to a VLM
  return {
    stages,
    total: fallback,
    baselineFullPageVision: baseline,
    savedVsBaseline: Math.max(0, baseline - fallback),
  };
}
