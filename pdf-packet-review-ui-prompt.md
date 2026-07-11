# PDF Packet Review — UI Build Prompt

A ready-to-paste prompt for building **only the presentation UI** (React) of
the PDF packet review tool. OCR, splitting, classification, and data capture
are assumed already done — this prompt covers the display layer alone.

See `pdf-packet-review-design.md` for the full design rationale.

---

## The prompt

Copy everything in the block below into a fresh session.

```
Build ONLY the presentation UI for a PDF packet review tool, in React. OCR,
document splitting, classification, and data capture are already done — do
NOT build any of that. You are consuming existing outputs and rendering them.
Match the conventions of the existing React app (same version, styling
approach, and folder structure) — inspect it first before adding anything.

WHAT ALREADY EXISTS (assume available via API / on disk):
- A packet is split into documents. A packet has 10–400 documents; each
  document has one or more pages.
- For each document: a type label (e.g. "Lab report"), a status
  (verified / needs review / low quality), and captured fields as
  key/value pairs.
- Each captured field has source coordinates: page number + bounding box.
- Each page has a pre-rendered thumbnail image and a full-res image (or a
  source PDF page reference).
Assume a JSON shape like:
  packet  -> documents[] -> { id, type, status, pages[], fields[] }
  fields[] -> { label, value, page, bbox:[x,y,w,h] }
  pages[]  -> { pageNumber, thumbUrl, fullUrl }
If the real shape differs I'll adjust; keep all data access behind ONE typed
adapter/hook so the shape is easy to swap.

THE UI — three zones. Design principle: coverflow is a finishing move, NOT
the top-level navigator — nobody flips through 400 tilted cards.

1. Navigator (left rail) — primary way to move through the packet.
   - Documents grouped by type with counts ("Lab reports · 40").
   - Search + filters at top (type, status, page range).
   - VIRTUALIZED with @tanstack/react-virtual (or react-virtuoso) so it stays
     smooth at 400 documents.

2. Coverflow (top of main area) — the delightful accent.
   - Renders ONLY when the filtered/selected set is small (≤ ~15 documents);
     carousels documents WITHIN a group, never all 400.
   - Above ~15 items, fall back to a thumbnail grid automatically based on the
     filtered count.
   - iPod-style tilt via CSS 3D transforms (perspective + rotateY + scale):
     center card upright and enlarged, side cards angled and scaled down,
     smooth transition on select. No heavy carousel library needed.
   - Arrow buttons + dot indicators as a keyboard-accessible fallback; support
     Tab / Left / Right.

3. Split view (main area) — where the work happens.
   - Left: selected document's captured fields with a status badge
     (verified / needs review / low quality).
   - Right: the actual PDF page. Use react-pdf (pdf.js) if the source is PDF;
     otherwise render the page image with zoom/pan.
   - Field ↔ source highlighting: clicking a captured field scrolls to and
     highlights its bbox as an overlay on the correct page. This traceability
     is the most important feature — prioritize it. Scale bbox coords to the
     rendered page size.

Also add a "needs review" filter that shows only low-confidence documents.

CONSTRAINTS
- Presentation only. Ship a mock fixtures file matching the shape above so it
  runs standalone; all data access stays behind the one adapter/hook.
- Flat, clean, generous whitespace. Wide-screen first; degrade the coverflow
  to a thumbnail rail on narrow screens.
- Reuse the app's existing components/design tokens rather than introducing a
  new UI kit.

Show me the component breakdown and the mock fixtures file before writing the
full implementation.
```

---

## Notes on the library choices baked in

- **List virtualization:** `@tanstack/react-virtual` (or `react-virtuoso`).
  Keeps the navigator smooth at 400 documents.
- **Coverflow:** plain CSS 3D transforms (`perspective` + `rotateY` + `scale`).
  No carousel dependency needed.
- **PDF viewer:** `react-pdf` (pdf.js wrapper) for zoom, text selection, and
  highlight overlays; fall back to a plain image viewer if pages are images.

If the existing app already has equivalents installed, swap these names — the
prompt already instructs the build session to inspect and reuse existing
conventions first, which should catch that.

---

## Before you run it — two optional tweaks

- If your data shape differs from the assumed JSON, paste the real shape in
  place of the `packet -> documents[] -> ...` block.
- If your app already has a virtualization or PDF library, name it so the
  build session uses that instead of introducing a new one.
