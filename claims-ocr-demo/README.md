# claims-ocr-demo

A small, **zero-token** claim-form OCR pipeline that runs entirely in GitHub Actions
(nothing installs or runs locally). It demonstrates the cost-effective flow discussed
for CMS-1500 / UB-04 intake:

```
PDF  ->  probe (skip OCR if text layer)  ->  rasterize  ->  zonal crop
     ->  Tesseract OCR (local, 0 tokens)  ->  field table + confidence
     ->  low-confidence fields flagged for review
```

## What it shows

- **Tier 0 — probe:** `digital.pdf` has a real text layer, so OCR is skipped entirely.
- **Tier 2 — zonal OCR:** `good_scan.pdf` is read box-by-box with Tesseract; each field
  gets a value **and a confidence score**.
- **Resolution matters:** `small_scan.pdf` is deliberately low-res, so its confidence
  drops and fields get flagged — exactly where a (token-paying) vision fallback or a
  human reviewer would take over.

Everything up to the field table is local and costs **no LLM tokens**. Tokens would only
enter at an optional vision fallback for the flagged fields.

## How it runs

GitHub Actions builds the samples and runs the pipeline on every push; read the output
(the field tables) in the **Actions log**. To run it as a one-off, trigger the
**Claims OCR Demo** workflow manually (workflow_dispatch).

## Stack

- `tesseract.js` — OCR (WASM, no system install)
- `pdf-to-png-converter` — rasterize PDF pages
- `sharp` — crop / grayscale zones
- `pdfjs-dist` — text-layer probe
- `pdf-lib` — generate the sample forms

## Layout

- `src/template.js` — normalized box coordinates (one source of truth)
- `src/generate-samples.js` — builds the sample PDFs in CI
- `src/pipeline.js` — probe + rasterize + zonal OCR -> field table
- `src/run.js` — runs the pipeline on the samples
