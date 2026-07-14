# Similar Claims — UI Design Reference

Design reference for the "similar claims" discovery flow: sample a few claims
from a generic ask, pick one, and find claims similar to it — with optional
refinement.

Status: design (approved layout). Last updated: 2026-07-12.
Related: `pdf-packet-review-design.md` (same product family — scan/capture →
review → find similar).

---

## 0. App shell — chat-driven canvas

The app is two panes: a **chat area** (ChatKit) and a **work area** (the main
page). The governing principle:

> **Chat is just a driver. All events happen on the right (the workspace).**

Chat is the command / follow-up layer; the workspace holds all content. Every
chat turn that yields data sets what the workspace shows.

### Canvas = single focus + a shallow view stack

The workspace shows one focus at a time and navigates a small stack, with a
breadcrumb:

```
collection view  →  detail view   →  related view
(5 claims)          (Know more)       (similar claims)
5 claims → CLM-40921 → detail / similar
```

Chat can jump to any node ("explain CLM-40921", "similar to CLM-40921"). Canvas
controls (`Know more`, `Similar claims`) do the same by **posting the follow-up
back into chat** — one source of truth, driven two ways. `Know more` and
`Similar claims` are symmetric: both are chat-triggered commands whose *output*
renders in the workspace, just different nodes of the same stack.

### Two levels of LLM interpretation

1. **List level (cheap, scannable) — one clinical sentence per claim.** On
   fetch, the LLM writes a plain-language gist of each claim's clinical features
   ("routine cardiology visit for a diabetic; level-3 E/M with basic labs") —
   not a code dump. That single line is what makes the view feel crisp instead
   of like a spreadsheet.
2. **Detail level (on demand) — `Know more` → full explanation.** Opens the
   detail view where the LLM explains the claim in depth (what the dx/procedure
   mean in plain terms, why the codes go together, anything notable — cost
   outlier, unusual combo). Prose-forward, still no table.

Keep them separate: don't run the deep explanation for all N up front (slow,
costly) — one-liners for the list, rich explanation only when asked.

### Answers in the workspace, questions in chat

Because chat is only a driver, substantive output never lives in the thread:

| Response type | Where it goes |
|---|---|
| Substantive / structured / reference-worthy (explanation, comparison, claim detail, similar claims) | **Workspace** |
| Ephemeral conversational glue ("filtered to cardiology", "found 5", "which one?") | **Chat** |

Rule of thumb: *does it have lasting reference value?* Yes → workspace, no →
chat. Follow-up questions ("why is the billed amount high?") are asked in chat
but their **answers update the workspace detail view** (append a section,
highlight a field) — keeping the claim context intact and everything about one
claim in one place. Chat gets only a short pointer ("Explaining CLM-40921 in the
workspace"), which doubles as the breadcrumb/history. One pragmatic exception: a
one-word clarification ("yes, in-network") can answer inline in chat — don't
force a workspace transition for it.

### Card style — crisp, not Excel

Cards, not rows. The LLM's one-line clinical summary is the hero of each card;
facets (`Dx E11.9 · CPT 99213 · billed $2,480`) sit below as a quiet
dot-separated line, never a column grid. Generous whitespace, typographic
hierarchy, the designed-cover styling from `pdf-packet-review-design.md` §4a.
Each card carries `Know more` and `Similar claims` actions.

### Implementation notes

- **Stream the interpretations.** Render cards immediately from the fetched
  structured data (id, type, facets), then stream the LLM one-liner into each
  card with a skeleton placeholder — the canvas populates instantly, prose fills
  in.
- **Ground the LLM to avoid clinical hallucination.** Feed it the structured
  captured fields and have it interpret only those ("based on the coded data");
  it describes what the codes are, not invents clinical narrative. Keep the
  deeper `Know more` explanation cautious. (Wire the latest Claude model here;
  spec separate prompts for the list one-liner vs the deep explanation.)

---

## 0a. Visual style — minimalist, monochrome

The chosen visual language is **minimalist and colorless**. Meaning is carried
by typography, whitespace, and quiet outline icons — never by color. This is the
shared style for all screens; where earlier sections show colored badges,
accent chips, or role tints, prefer the neutral treatment below.

**Palette — neutrals only.** Use `--text-primary`, `--text-secondary`,
`--text-muted`, `--surface-2`, `--border` / `--border-strong`. No accent color,
no success/warning/danger tints, no filled colored chips.

**Color never encodes meaning — icon + label + position do.** Status is shown by
a *different outline icon* plus a muted word, all in neutral tone:

| Status | Icon (monochrome) | Label |
|---|---|---|
| Verified | `ti-circle-check` | verified |
| Needs review | `ti-alert-circle` | needs review |
| Low quality | `ti-help-circle` | low quality |

The user distinguishes them by icon shape and text, not by red/amber/green.
Likewise match reasons render as plain `✓` / `≠` marks in neutral tone, not
green/gray pills.

**Typography does the hierarchy.** Two weights only (400 / 500) and size/space
carry emphasis: the claim id at 14px/500, meta at 12px/muted, the LLM summary at
~13.5px/primary as the hero line, facets at 12px/secondary. No bold-for-emphasis
beyond the weight-500 headings.

**Structure — hairlines and whitespace, not boxes.** Prefer list items separated
by a `0.5px --border` rule with generous padding over bordered cards; drop the
card boxes where you can. Never a column grid — facets are a quiet dot-separated
line (`Dx E11.9 · CPT 99213 · billed $2,480`).

**Icons — Tabler outline, quiet, monochrome.** 14–16px inline, inherit the
parent's (usually muted/secondary) color; never `-filled`. Icons support the
text, they don't decorate. Decorative icons `aria-hidden`; icon-only controls
get `aria-label`. Keep the semantic set from §8, just rendered in neutral tone.

**Actions — text links, not buttons.** `Know more` / `Similar claims` are quiet
text with a small leading outline icon in `--text-secondary`; hover lifts to
`--text-primary` with a `--border-strong` underline. No accent fills.

**Restraint.** Fewer borders, more whitespace; the quieter option wins. Sentence
case everywhere. The one place a single hairline-boxed emphasis is still allowed
is a true anchor (e.g. the episode index claim) — and even there, use a slightly
heavier border, not a fill.

---

## 1. The flow

1. **Generic ask → sample.** User asks something like "give me 5 professional
   claims." Return ~5 random claims as cards (reuse the designed-cover cards
   from the PDF packet work). Allow a loose filter ("5 professional cardiology
   claims over $2k") and a "reroll" for another 5.
2. **Pick one → "Similar claims" link.** Each claim card has a simple
   `Similar claims →` link. That link is ONLY a trigger — it does not try to
   be the whole experience.
3. **Link opens a drawer.** Clicking it fetches immediately (default lens) and
   slides in a right-side drawer with the results. The original 5 claims stay
   visible (dimmed) behind it, so the user never loses their place.

Key principle: **the link is the entry point; all the richness lives in the
drawer it opens.** Don't turn the refinement options into more links next to
"Similar claims" — that recreates the cold-start problem (choosing before
seeing).

---

## 2. Fetch-first, refine-after (not options-first)

When the user clicks "Similar claims":

1. **Fetch immediately** using the default lens ("Clinically similar").
2. **Show results right away** — no empty state, no form to fill.
3. The lenses and scope chips sit ABOVE the results as refinement controls.
4. Clicking a lens or toggling a chip **re-ranks / re-fetches** the list.

So the click doesn't *start* a search — it *steers* one that already ran. A
user who doesn't care about parameters gets a good answer in one click and
never touches a control; a power user still has every knob.

**Default lens:** Clinically similar (diagnosis + procedure is what "similar
claim" usually means to a person). If the primary job is fraud/duplicate work,
consider defaulting to "Possible duplicates" instead. Optionally remember the
user's last-used lens and default to that on the next claim.

**Same-member is NOT the default.** By default, similar search spans ALL
members. "Same member" is a scope filter the user opts into (see §4).

---

## 3. Drawer layout

```
┌───────────────┬──────────────────────────────────────────────┐
│ Your 5 claims │  Similar claims                          [✕]  │
│ (dimmed)      │  ┌────────────────────────────────────────┐  │
│               │  │ 🧾 Seed · CLM-40921            pinned   │  │
│ CLM-40921     │  │ 837P · Cardiology · 99213 · E11.9 · …   │  │
│  Similar → ●  │  └────────────────────────────────────────┘  │
│               │  Similar in what way?                         │
│ CLM-40188     │  (🩺 Clinically) (💲 Financially) (👤 Same    │
│ CLM-41320     │   provider) (⧉ Possible duplicates)           │
│ CLM-39774     │  Scope (stack on any lens)                    │
│               │  [Same member off] [Same provider off] [±30d] │
│               │  Top matches                 Clinically similar│
│               │  ┌────────────────────────────────────────┐  │
│               │  │ CLM-41188                        96% ▓▓ │  │
│               │  │ Cardiology · 99213 · E11.9 · $2,510      │  │
│               │  │ ✓dx  ✓CPT  ✓specialty    [New seed ↗]   │  │
│               │  └────────────────────────────────────────┘  │
│               │  … more results …                             │
└───────────────┴──────────────────────────────────────────────┘
```

Contents, top to bottom:
- **Header:** "Similar claims" + close (✕).
- **Seed claim, pinned:** always shows what you're comparing against, even
  after chaining seeds.
- **Lenses** ("Similar in what way?"): switch the ranking.
- **Scope chips** ("stack on any lens"): hard filters (same member, same
  provider, ±30 days) that narrow ANY lens.
- **Results:** ranked list, each with match %, a match bar, a one-line summary,
  self-explaining match reasons, and a "New seed ↗" action.

Sizing:
- Keep the drawer **wide** (~60% or a fixed ~560px). Claims are dense and the
  match reasons need room; a narrow drawer forces cramping.
- On **mobile**, the drawer becomes a full-screen sheet; the background list
  hides. Same content, stacked.

---

## 4. Two-layer similarity model (how criteria are defined)

There are two *kinds* of criteria, and every lens is a recipe combining them:

1. **Scope filters** — hard yes/no conditions that NARROW which claims are
   eligible. Identity/equality, not similarity. E.g. same member, same
   provider, same claim type, within N days, same state.
2. **Similarity signals** — soft, weighted, RANKED closeness on fields like
   diagnosis, procedure, cost. They order whatever survived the filters.

```
All claims → [1. Scope filters: hard, narrows] → Candidate pool
           → [2. Signals: weighted, ranks]     → Ranked results
A lens = a preset of BOTH (which filters on + how signals are weighted).
```

- **"Same member" lives in layer 1** — a filter you can stack on ANY lens.
  That's how combinations work (e.g. "this member's clinically-similar claims"
  = Clinically similar lens + Same member filter).
- **"Clinically / Financially similar" live in layer 2** — different weight
  presets over the same signals.

### 4a. Per-field distance functions (how "close" is measured)

"Similar diagnosis" is meaningless until you define *how*:

| Field | How closeness is scored |
|---|---|
| Member | exact only — identity, so it's a filter (1/0), never "kind of similar" |
| Provider | exact NPI (1/0), or "same specialty/taxonomy" as a softer match |
| Diagnosis (ICD-10) | tiered: exact = 1.0 · same subcategory (E11.9↔E11.65) = 0.7 · same CCSR/chapter = 0.4 · else 0 |
| Procedure (CPT) | tiered: exact = 1.0 · same code family/range = 0.6 · same service category (BETOS) = 0.3 |
| Cost (billed/allowed/paid) | numeric band `1 − |a−b|/scale`, or "same decile"; ideally z-scored WITHIN the same procedure |
| Date of service | window: within N days = 1, decaying after |
| Place of service / units | exact categorical / numeric proximity |

### 4b. Lens definitions (filters + weights)

| Lens | Scope filters (hard) | Signal weights (soft) |
|---|---|---|
| Clinically similar | same claim type | diagnosis ●●● · procedure ●●● · specialty ● · cost — |
| Financially similar | same claim type | cost ●●● · procedure ●● (anchor) · allowed/paid ●● · diagnosis ○ |
| Same provider pattern | provider = exact | diagnosis ●● · procedure ●● · cost ● |
| Possible duplicates | member = exact · provider = exact · DOS ±3 days | procedure ●●● · cost ●●● (near-exact) |
| This member's history | member = exact | no ranking — sort by recency, or layer any lens on top |

### 4c. The "Financially similar" trap

Raw cost similarity alone is nearly useless — a $2,480 office visit is
"financially similar" to a $2,480 MRI, which no analyst wants. Money is only
meaningful *conditioned on what was done.* So "Financially similar" must be
anchored on procedure. The genuinely valuable financial question is usually
**"same service, outlier price"** (price-variation / overpayment detection),
not "similar dollar amount."

### 4d. Two things to lock the real presets

1. Which fields are reliably populated in the 837P/837I extracts (e.g. is
   allowed/paid present, or only billed? are taxonomy codes present?).
2. The top 3–4 questions analysts actually ask → those become the lenses;
   everything else stays in the chips for power users.

---

## 5. Explainability and chaining

- **Every result explains itself.** Show match % + a match bar + per-facet
  reason chips (`✓ dx`, `≠ CPT`). For audit/duplicate/overpayment work, *why*
  a claim is similar matters as much as *that* it is.
- **Chained seeds.** Each result has "New seed ↗" to pivot and search again.
  The whole trail stays in one drawer; the pinned seed updates.

---

## 6. Recommended upgrade — side-by-side diff

A ranked list tells you *that* two claims are similar, not *how* they differ.
Add a **field-by-field comparison** (click a result → expands into a diff vs
the pinned seed):

```
Field         Seed · CLM-40921      Match · CLM-40733 (87%)
Diagnosis     E11.9                 E11.9                (same)
Procedure     99213                 99214 ↑              (differs)
Specialty     Cardiology            Cardiology           (same)
Provider      NPI 1487…915          NPI 2033…104         (differs)
Billed        $2,480                $2,455               (differs)
Allowed       $1,910                $2,290 ↑ +$380       (differs)
Network       In-network            In-network           (same)
```

Matching fields plain; differing fields highlighted (warning tint) with a
direction arrow. This surfaces the *story* — "same clinical picture, higher
procedure level, $380 more allowed" — which is exactly what claims work is
about. Low effort, high payoff; add it regardless of user type.

---

## 7. Situational extras (don't over-build)

- **Natural-language refine box** — "similar but out-of-network and higher
  cost" → parameters. A thin extra input that COMPLEMENTS lenses; don't drop
  lenses for it (NL alone is undiscoverable — "what can I even type?").
- **2D map / scatter** (e.g. cost × clinical distance) — reveals clusters and
  outlier-priced claims across large result sets. Reserve for an "analytics"
  mode; only worth it for fraud/SIU/payment-integrity work over many results.

Best realistic UI: **drawer + default lens + refine controls + click-to-diff**,
with the NL box as a thin extra and the map reserved for later. Covers the
novice (one click), the refiner (lenses/chips), and the analyst (diff), without
over-building.

---

## 8. Iconography (Tabler outline icons)

The small icons are part of the design — they give instant recognition. Use
Tabler **outline** icons (never `-filled` variants).

| Element | Icon | Notes |
|---|---|---|
| Seed / claim | `ti-file-invoice` | in the pinned seed header and claim rows |
| Seed marker (in diff) | `ti-target` | accent color, marks the seed column |
| Lens · Clinically similar | `ti-stethoscope` | |
| Lens · Financially similar | `ti-currency-dollar` | |
| Lens · Same provider | `ti-user-check` | |
| Lens · Possible duplicates | `ti-copy` | (duplicate = copy) |
| Scope · Same member | `ti-user` | |
| Scope · Same provider | `ti-user-check` | |
| Scope · Date window | `ti-calendar` | |
| Close drawer | `ti-x` | secondary text color |
| New seed / pivot action | `ti-arrow-up-right` (↗) | trailing arrow on the button |
| Match reason — matches | `✓` (check) | on green (`--bg-success` / `--text-success`) |
| Match reason — differs | `≠` (not-equal) | on neutral (`--surface-1` / `--text-secondary`) |
| Diff — value higher/lower | `↑` / `↓` | inline with the differing value |
| Reroll sample | `ti-refresh` | on the "another 5" action |

Sizing: 13–20px inline. Icons inherit color + size from their parent. Give
decorative icons `aria-hidden="true"`; give icon-only buttons an `aria-label`.
Lens icons sit left of the lens label; the seed icon sits left of "Seed ·
CLM-…". Keep them small and quiet — recognition aids, not decoration.

---

## 9. Performance note

Re-fetching on every chip toggle can be expensive against Teradata. Preferred:
**fetch a candidate pool once** (e.g. top ~100 by a base similarity), then
**re-rank on the app tier** when lenses/chips change — instant, no DB round
trip. Re-query the DB only when the user needs a genuinely wider net.
