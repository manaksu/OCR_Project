# Claims OCR → X12 Pipeline — Overview

A working reference implementation for turning **scanned claim forms (CMS-1500 / UB-04)
into reliable, structured X12 data**, with a transplant-bundle roll-up on top. Everything
runs **on-premise** (no PHI leaves the environment) and the bulk of the work costs **zero
LLM tokens**.

Repository: `manaksu/OCR_Project` → code in `claims-ocr-demo/`.

---

## 1. The problem

A scanned claim form is just **pixels** — an image of a page. There is no structured data in
it. Getting from that image to payer-ready **X12 837** data is fundamentally an **OCR +
validation** problem, and "reliable" comes almost entirely from the **validation layer**, not
the OCR. No OCR engine alone is trustworthy enough to feed straight into an 837; you will ship
denials. This project demonstrates the full, layered pipeline that earns that reliability.

---

## 2. Architecture at a glance

```
PDF (local / cloud)
  └─ 1. INGEST / TRIAGE     text-layer? skip OCR.   classify CMS-1500 vs UB-04
  └─ 2. PREPROCESS          deskew · register · crop · grayscale        (OpenCV-class, free)
  └─ 3. OCR (per zone)      Tesseract / PaddleOCR — recognizes CHARACTERS only   (0 tokens)
  └─ 4. FIELD TABLE         the canonical intermediate (box → value + confidence)
  └─ 5. VALIDATE + HITL     NPI Luhn, CPT/ICD code sets, confidence gating       (0 tokens)
  └─ 6. X12 GENERATION      validated field table → 837P / 837I
        (+ optional VISION-MODEL fallback on flagged fields — the ONLY token cost)
```

**Bundle layer** (transplant use case) wraps the per-claim pipeline as an inner loop:

```
BUNDLE (many PDFs, or one combined PDF)
  → split into documents → run each through stages 1–6
  → look up provider/category by NPI (reference data)
  → ROLL UP billed charges: grand total · per-provider · per-category
  → RECONCILE vs contracted case rate (variance)
```

---

## 3. Key design principles

### 3.1 The field table is the hub, not a by-product
Everything reads from one canonical intermediate: `{ box → value, confidence, provenance }`.
Validation writes back to it; X12 is *rendered from* it; "further processing" queries it. X12 is
one output of the field table, not the source of truth.

### 3.2 OCR recognizes; your code interprets
- **OCR** (Tesseract/PaddleOCR) turns pixels into **characters** — e.g. `"11 99213 J20.9 150.00 1"`.
  It has no concept of "Box 33" and does not interpret meaning.
- **Interpretation** is done by deterministic, auditable code, driven by the **standard box
  layout** (which box = which field) and **code sets** (is this a real CPT?). This is where the
  intelligence about claims lives — and it is rules, not a black box, which is what makes it
  trustworthy in healthcare.

### 3.3 Reliability = layers, not a single reader
Demonstrated empirically on a low-res sample: a misread `99213 → 88213` passed the **confidence**
gate (conf 66) but was caught by **code-set validation**; a `J20.9 → J20.6` swap (valid → valid)
slipped *both* and would need **human review**. No single layer is enough — confidence gating
**and** validation **and** HITL together are what produce reliable X12.

### 3.4 Token cost scales with hard fields, not claim volume
The entire happy path is **0 tokens** (local OCR + deterministic validation). The only metered
cost is an **optional vision-model fallback** on *flagged* fields. A clean claim costs nothing; a
bad scan costs only the few smudged fields — never the whole page.

### 3.5 On-prem, PHI-safe, free engines
Tesseract and PaddleOCR are open-source (Apache 2.0), run locally with **no data egress**, and
need **no Business Associate Agreement**. This is often *more* compliant than cloud OCR, not less.

---

## 4. Coordinates & the standard box layout

The foundation is a **standard box layout (zone template) per form type**, built once from the
official reference:

| Form | Standard body | → X12 | Reference |
|---|---|---|---|
| CMS-1500 (professional) | NUCC boxes 1–33 | **837P** (`005010X222A1`) | NUCC manual + 837P TR3 |
| UB-04 (institutional) | NUBC form locators FL1–81 | **837I** (`005010X223A2`) | NUBC manual + 837I TR3 |

Each box entry is metadata-driven (a data dictionary), e.g.:

```yaml
box33_billing_npi:
  rect: [0.60, 0.90, 0.97, 0.945]          # WHERE — normalized fraction of the form
  field: billing_provider_npi               # WHAT it means
  x12: { loop: 2010AA, segment: NM1, qualifier: XX }   # WHERE it maps in 837
  validate: npi_luhn                         # how to check it
  phi: false
```

**Coordinates are stored as fractions (0–1), not pixels**, so one template works at any document
size: a box at `0.60` across is `0.60 × pageWidth` px on any scan. Different *size* is handled by
the fractions; shift/skew/rotation/margins are handled by a **registration** step (align the scan
to the form's canonical frame via corner marks/borders) *before* cropping. Normalize to the
detected **form** rectangle, not the raw page, so different paper sizes and margins also work.

---

## 5. The conversion, by example

A single CMS-1500 claim, end to end (real output from `node show-conversion.js`):

**Stage 1 — OCR (raw text):**
```
box24_service_ln  "11 99213 J20.9 150.00 1"   (conf 94)
box33_billing_npi "1234567893"                 (conf 96)
```

**Stage 2 — structured + validated:**
```
service line : POS=11 CPT=99213 ICD=J20.9 charge=150 units=1   [valid]
billing NPI  : 1234567893   [valid — Luhn check]
total charge : $150.00      needs review: none
```

**Stage 3 — X12 837P (excerpt):**
```
NM1*85*2*BILLING SERVICE*****XX*1234567893~     ← NPI → billing provider, qualifier XX
NM1*IL*1*SMITH*JOHN*A***MI*ABC123456789~        ← patient name split; member ID
CLM*CLAIM0001*150.00***11:B:1*Y*A*Y*Y~          ← claim header (POS 11, total)
HI*ABK:J209~                                    ← ICD-10 principal dx (decimal dropped)
SV1*HC:99213*150.00*UN*1***1~                   ← service line: CPT, charge, units, dx pointer
```

The conversion layer **parsed** the string into fields, **validated** each (Luhn / code sets),
and **re-tagged** every value with the EDI qualifier and loop/segment it belongs in.

---

## 6. Bundle processing (transplant case rate)

The headline deliverable for the transplant use case is a **case-level billed-charges roll-up**.
A bundle of provider documents (facility/UB-04, surgeon & anesthesia/CMS-1500, organ acquisition,
labs) is processed document-by-document, then aggregated:

- **Grand total billed**, **per-provider**, **per-service-category**
- **Reconciliation** vs the contracted case rate (variance)
- Provider name + category resolved by **NPI → reference lookup** (in production, the MCP /
  Teradata-Oracle reference table; unknown NPIs flag as "Unknown / Unclassified")

Sample result (5 documents): grand total **$434,000**, case rate **$410,000**, variance
**+$24,000 over**, 1 document flagged for review, 249 tokens.

**Input is flexible:** upload many PDFs (one document each) or a single combined multi-page PDF
(split one document per page). A web UI provides the upload + roll-up view.

---

## 7. Token & cost model

The pipeline reports tokens **per stage** and an estimated **dollar cost** (Haiku/Sonnet toggle):

| Stage | Tokens |
|---|---|
| Ingest / OCR / Validation / X12 (local) | **0** |
| Vision fallback (flagged fields only) | the only non-zero line |

For the sample transplant bundle: **~$0.0005 (Haiku)** for the whole bundle, vs **~$0.013** if
every page were sent to a vision model. The dominant *real* cost is not tokens — it is **human
review labor** for flagged documents, which is why minimizing flags (better OCR, e.g. PaddleOCR)
matters more than minimizing tokens.

---

## 8. Reference / MCP integration concept

Provider/category resolution and code-set validation are **reference-data lookups** against
source systems (e.g. Teradata + Oracle). The recommended access pattern is an **MCP server** (a
read-only "teller window") in front of the data:

- the application/agent never gets raw DB credentials or arbitrary SQL;
- the MCP exposes a fixed menu of read-only tools (`validate_npi`, `lookup_payer`, …);
- it can route to multiple databases, mask PHI, and audit every call.

In the demo this is a local `reference.json`; in production it becomes the MCP-fronted master-data
lookup. A separate **query-builder** module (metadata-driven from the data dictionary, parameterized,
dialect-aware for Teradata vs Oracle) keeps SQL-building rules testable and out of the access layer.

---

## 9. Components (in `claims-ocr-demo/`)

| File | Role |
|---|---|
| `src/template.js` | CMS-1500 box layout (normalized zone coordinates) |
| `src/rasterize.js` | PDF page → image (pdfjs + canvas) |
| `src/pipeline.js` | probe text-layer → rasterize → zonal Tesseract OCR → field table |
| `src/serviceline.js` | parse the service line by pattern (charge-by-shape, ICD-decimal fix) |
| `src/validate.js` | NPI Luhn + CPT/ICD code-set checks |
| `src/claim.js` | assemble the structured claim model (header + service lines + total) |
| `src/tokens.js` | per-stage token + dollar-cost estimate |
| `src/x12.js` | field table → 837P segments |
| `src/bundle.js` | per-bundle processing + roll-ups + reconciliation; upload handling |
| `server.js` | Express API + viewer + bundle upload |
| `public/index.html` | single-claim viewer (image, fields, charges, validation, cost) |
| `public/bundle.html` | bundle roll-up + upload bar |
| `show-conversion.js` | prints raw OCR → structured → 837P for one claim |

Stack: Node.js, `tesseract.js` (WASM OCR — no system install), `pdf-lib`, `pdfjs-dist`,
`@napi-rs/canvas`, `sharp`, `express`, `multer`. All Apache/MIT-class, all local.

---

## 10. How to run

```bash
cd claims-ocr-demo
npm install
npm run serve          # generates samples + bundle, starts the server
# open http://localhost:3000/bundle.html   (bundle roll-up + upload)
#      http://localhost:3000/              (single-claim viewer)

# CLI demos:
node show-conversion.js   # OCR → structured → 837P for one claim
node run-bundle.js        # transplant bundle roll-up in the terminal
```

---

## 11. Status & roadmap

**Done (end to end):**
- CMS-1500 zone template, zonal OCR, field table
- Validation (NPI/CPT/ICD), confidence gating
- 837P generation (claim-level segments)
- Transplant bundle roll-up + reconciliation
- Bundle upload (many PDFs or one combined PDF, split per page)
- Per-stage token + dollar-cost reporting
- Web UI for single-claim and bundle views

**Next:**
- **UB-04 box layout + 837I mapper** + a **form classifier** (auto-route 1500 vs UB-04)
- **Smart document splitter** for combined bundles (form-type-change / cover-sheet boundaries,
  for multi-page provider documents)
- **Registration** (deskew + anchor alignment) for real, non-aligned scans
- **PaddleOCR / RapidOCR** as a higher-accuracy local fallback tier (lowers review rate; still 0 tokens)
- **X12 envelope** (full ISA fixed-widths, real payer/submitter IDs) + **SNIP validation**
- **Reference data via MCP** (NPI → provider/category, code sets) against Teradata/Oracle

---

## 12. One-line summary

**Scanned CMS-1500/UB-04 → local OCR → validated field table → X12 837**, with a transplant
bundle roll-up and reconciliation — reliable because of the validation layer, cheap because the
work is local and token-free, and compliant because nothing leaves the environment.
