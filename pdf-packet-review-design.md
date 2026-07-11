# PDF Packet Review Tool — Design Reference

A design reference for a tool that scans PDF document packets, captures the
information inside them, and displays both the captured data and the source
PDF pages in an aesthetic, navigable way.

Status: exploration / design only (no code yet).
Last updated: 2026-07-10

---

## 1. The problem

- Input is a **packet** of scanned PDF documents.
- A packet contains **10 to 400 documents**.
- Each document may be **multiple pages**.
- Packets arrive **mixed**: sometimes one big merged PDF that must be split
  into its constituent documents, sometimes already-separate files.
- Goal: capture the information from each document, then display **both**
  the captured data **and** a way to view the actual PDF page it came from.

---

## 2. Design principle: scale changes everything

The right UI depends entirely on how many documents are in view.

| Scale | Primary problem | Right pattern |
|-------|-----------------|---------------|
| 5–15 docs | "Which of these few?" | Coverflow browsing |
| 10–400 docs | "Find the right one in a pile" | Search + grouping + virtualized list |

**Key decision: coverflow is a finishing move, not the top-level navigator.**
Nobody flips through 400 tilted cards. Coverflow is delightful for a *filtered
handful*; it's unusable as the way you face the whole packet.

---

## 3. Recommended layout — three zones

```
┌─────────────────────────────────────────────────────────────┐
│  Search: [ find in 400 documents...              🔍 ]        │
├──────────────────┬──────────────────────────────────────────┤
│  NAVIGATOR       │   COVERFLOW (only when filtered ≤ ~15)    │
│  (grouped,       │   ◄  [tilted]  [ CENTER ]  [tilted]  ►    │
│   virtualized)   ├──────────────────────────────────────────┤
│                  │   CAPTURED DATA      │   ACTUAL PDF PAGE  │
│  ▸ Claim forms 12│   Claim ID  40921    │   ┌────────────┐   │
│  ▾ Lab reports 40│   Member    Alvarez  │   │            │   │
│    • CBC panel   │   Amount    $2,480   │   │  page img  │   │
│    • Lipid panel │   [verified]         │   │            │   │
│    + 38 more...  │                      │   └────────────┘   │
│  ▸ Referrals   8 │   (click a field →   │   [Open full PDF] │
│  ▸ ID cards    3 │    highlights source)│                   │
└──────────────────┴──────────────────────┴───────────────────┘
```

1. **Navigator (left rail)** — the primary way to move through the packet.
   - Documents **grouped by detected type** with counts
     (e.g. "Lab reports · 40", "Claim forms · 12").
   - **Search + filters** at the top (type, status, page range, field values).
     At 400 docs, search is primary UI, not decoration.
   - **Virtualized** — render only visible rows or it janks at scale.

2. **Coverflow (top of main area)** — the delightful accent.
   - Appears only after filtering to a small set (≤ ~15 items).
   - Carousels **documents within a group**, never all 400 at once.
   - Beyond ~15 items, fall back to a thumbnail grid automatically based on
     the filtered count.
   - Keep dot indicators + arrow buttons as a plain, keyboard-accessible
     fallback — angled cards alone are poor for a11y.

3. **Split view (main area)** — where the real work happens.
   - **Left:** captured / extracted data for the selected document, with a
     per-document **confidence/status badge** (verified / needs review /
     low quality) so users know what to trust.
   - **Right:** the actual PDF page, rendered from the source.
   - **Field ↔ source highlighting:** clicking an extracted value highlights
     the exact region on the PDF page it came from. This data↔source
     traceability is the single most valuable feature for trust — more
     valuable than any navigation gimmick.

---

## 4. Why coverflow is the right *instinct* (but demoted)

Strengths:
- A packet is a set of **distinct** documents, each with a recognizable
  first page — exactly what coverflow was designed for.
- The tilt-and-center motion makes the current document unmistakable, even
  when documents look similar.

Weaknesses to design around:
- **It's a browser, not a reader.** Only one item is clear at a time. Use it
  to *select*, then read in the split pane — never read content inside it.
- **It doesn't scale.** 5–8 docs = delightful; 60+ = painful. Carousel
  documents, not every page.
- **Accessibility.** Angled cards aren't obviously clickable and are awkward
  for keyboard/screen-reader users. Always ship the plain fallback controls.

---

## 4a. Designing the coverflow covers (the readability fix)

**Problem:** a literal thumbnail of a scanned PDF page is unreadable — shrunk
to ~150px, dense text is just gray blur. So the cover must NOT be a photo of
the page.

**Reframe:** treat each cover like **album art** — a *synthesized identity
card* built from the data already captured, designed to be recognized at a
glance. The scan is the payload you open *after* picking, shown in the
split-view PDF pane — not the thing you flip through.

### What goes on a synthesized cover
- **Type color + icon** — the biggest win. Claim forms blue, lab reports red,
  ID cards green, etc. Users learn the color language fast and recognize a
  document before reading a word.
- **A human title** — the document identifier ("Claim CLM-40921"), rendered as
  real text, not scanned pixels.
- **2–3 key captured fields** — the ones that distinguish this document from
  its siblings (member, amount, date).
- **Page count + status badge** — "3 pages · needs review" visible on the
  cover itself. Tint low-confidence covers so triage happens while browsing.

### PDF-as-backdrop hybrid (recommended for the focused card)
Use the real scanned page as a **faded backdrop** for authenticity, with the
captured details overlaid on a **scrim**. It feels like flipping through real
documents while staying legible.

Rules that make it work:
- **The scrim is non-negotiable.** Never put text directly on a scan — stamps,
  tables, and signatures create unpredictable dark regions that swallow it.
  Use a solid bottom info-panel (start here — most legible) or a semi-opaque
  full-card wash (~80% `surface`). Avoid gradient scrims — they flicker during
  the coverflow transition and fight the flat aesthetic.
- **Keep the backdrop faint and desaturated** (~12–18% opacity, optionally
  grayscaled). The page is texture/authenticity here, not information.
- **Crop to the representative region** — the letterhead or the captured-title
  bbox — not page-1 top-left. You already have the bounding boxes.

### Tier by card position (also a performance win)
- **Side cards:** flat designed cover only (colored spine + icon + title). At
  40° tilt nobody reads them, and loading full page images for every card is
  wasteful.
- **Focused/center card:** load the real page backdrop + rich overlay.
  Lazy-load the full-res page only for the focused card.
- **Graceful fallback:** if a page image is slow or missing, drop to the flat
  designed cover — nothing breaks.

**Net:** designed covers everywhere + PDF backdrop on the focused card. You get
atmosphere where it counts and speed/legibility everywhere else — and a
designed cover is *more* useful than a readable thumbnail would be, because it
shows captured, verified data rather than raw ink.

---

## 5. What matters most at 400-doc scale

1. **Auto-classification is the whole game.** The value is that the system
   groups and labels documents so a human never scrolls a flat list of 400.
2. **Auto-segmentation (splitting).** Merged packets have no document
   boundaries; detecting where one document ends and the next begins is the
   hard, high-value part.
3. **Virtualize the list** (react-window / react-virtuoso / TanStack Virtual,
   or the vanilla-JS equivalent).
4. **Search + filter as primary UI** — by type, status, page range, or
   captured field values.
5. **A "needs review" queue** beats free browsing for real work: surface only
   the low-confidence captures so humans triage exceptions instead of paging
   through hundreds of fine ones.
6. **Adaptive display:** coverflow when few, thumbnail grid when many — chosen
   automatically from the filtered count.

---

## 6. Handling "mixed / unknown" document boundaries

Because packets sometimes arrive merged and sometimes pre-split, **design for
splitting from day one.** Every packet passes through a "segment into
documents" stage; for already-split inputs that stage is a no-op passthrough.

Boundary detection typically combines:
- Blank / separator-page detection.
- **Classification-change detection** — page N looks like a lab report, page
  N+1 looks like a claim form → boundary.
- Header/footer or page-numbering resets.

Plan for a **human "fix the split" UI** (merge/split adjacent pages).
Auto-segmentation is never perfect, and wrong boundaries corrupt everything
downstream.

---

## 7. Suggested stack (Python + web UI)

**Backend (Python):**
- Serve via **FastAPI**.
- Pipeline: ingestion → **OCR** (scans require it — Tesseract, a cloud OCR,
  or a vision model for messy scans) → **segmentation** → per-document
  **classification** → **field extraction** → **confidence scoring**.
- Pre-render page images (thumbnail + full-res) with `pdf2image` / `pymupdf`
  so the browser never renders 400 pages live.
- Persist captured fields **with source coordinates (bounding boxes)** to
  enable field↔source highlighting.

**Front end:**
- pdf.js is still worth using for the **viewer pane** even in a Python stack —
  it gives in-browser zoom, text selection, and highlight overlays. Pure
  server-rendered page images work too and are simpler, but lose those.
- Everything else (navigator, grouping, search, coverflow) is a
  straightforward web front end driven by the FastAPI backend.

---

## 8. Pragmatic build order (when moving from design to code)

1. **Ingest + OCR + render thumbnails** — prove a packet can become per-page
   images and text.
2. **Segmentation + classification** — the hard, high-value core.
3. **Field extraction + confidence scoring.**
4. **UI polish** (coverflow, field↔source highlighting) — the easy, fun part;
   it should come last, not first.

Set it up as a **git-backed project** from the start.

---

## 9. One-line summary

Keep coverflow — it's a good instinct — but demote it from "the navigator" to
"the browser for a filtered handful." At 400 docs the aesthetic win comes from
clean auto-grouping, fast search, and the data↔source split view; coverflow is
the delightful accent on top.
