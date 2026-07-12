# Transplant Packages — Similar Claims from Raw Coded Data

How to find similar claims for a **transplant package** — a scanned packet
containing UB-04 (837I) and CMS-1500 (837P) claims that are **coded but NOT
adjudicated** (ICD-10 and CPT are filled in; no DRG, no pricing).

Status: design. Last updated: 2026-07-12.
Related: `similar-claims-ui-design.md` (the general drawer/lens flow this
specializes) and `pdf-packet-review-design.md` (the capture pipeline this sits
on top of).

---

## 1. Two reframes that make this tractable

**a. A transplant package is an episode, not a claim.** A transplant generates
many claims across facilities, providers, and time: evaluation, organ
acquisition (donor costs), the transplant admission (a large UB-04/837I inpatient
claim), the surgeon/anesthesia/specialist professional claims (CMS-1500/837P),
then post-transplant follow-up and readmissions. "Similar claims" here means
**similar transplant episodes** — match the package's clinical signature, not a
single line item. Matching one UB against one 1500 inside the same package is
meaningless.

**b. UB-04 and CMS-1500 speak different code languages.** The institutional
claim carries DRG + ICD-10-PCS; the professional claim carries CPT/HCPCS. They
describe the *same* transplant with different values. So normalize both forms
into a **shared clinical concept layer** and run similarity on that — never on
raw codes directly.

```
UB-04 (dx, ICD-10-PCS, rev codes) ─┐
                                    ├─► shared concept layer ─► package signature ─► similar episodes
CMS-1500 (dx, CPT/HCPCS) ──────────┘   (organ, indication,        (match key)
                                        procedure, donor,
                                        complications)
```

---

## 2. The key constraint: coded but un-adjudicated

The package's claims have ICD-10 and CPT filled in, but no adjudication has
happened — **no DRG, no allowed/paid.** That's fine:

- **DRG was never required.** DRG is just a grouping *computed from* diagnoses
  and procedures. The concept layer (organ, indication, procedure, donor) is
  derivable straight from the raw codes already on the forms. Drop DRG and
  pricing as *inputs* entirely.
- **Match on the intersection of fields both sides have** (the raw clinical
  layer). Treat adjudication-only fields as *outputs*, not inputs.

| Field | On raw package (seed)? | In corpus? | Role |
|---|---|---|---|
| ICD-10 diagnoses | yes | yes | match signal |
| CPT / HCPCS / PCS procedures | yes | yes | match signal → organ, procedure |
| Organ type (derived) | yes (from codes) | yes | hard scope filter |
| Donor type (derived) | yes (from codes) | yes | signal / filter |
| DRG | no | not accessible yet | OUTPUT (future) — wired, disabled until DRG access |
| Allowed / paid / pricing | no | yes | OUTPUT — the benchmark you're after |

Note: with MS-DRG unavailable, the benchmark output is carried by
**allowed/paid pricing** on the matched historical episodes; DRG is added as an
extra output field once access is granted. Detection and matching do not depend
on DRG.

**Why this feature exists:** you have an un-priced transplant package and want
clinically-similar *historical* episodes so their DRG and pricing become your
benchmark/estimate. Raw clinical data is the key; the adjudicated fields on the
matches are the answer. No DRG or calculation is needed to FIND matches — only
to REPORT them.

---

## 3. Pipeline: coded package → matches

**1. Pull captured codes** — per claim: ICD-10-CM dx list, CPT/HCPCS,
ICD-10-PCS, revenue codes, POS, specialty, units. (From the PDF capture step.)

**2. Roll the package up into one episode signature:**

| Signature field | Derived from | How |
|---|---|---|
| Organ | transplant CPT / PCS | deterministic lookup: `50360→kidney`, `47135→liver`, `33945→heart`, `32851–54→lung`; PCS `0TY/0FY/02Y/0BY…` |
| Indication | principal / most-severe dx | ICD-10 → CCSR group |
| Procedure concept | CPT + PCS | normalize to single/double, SPK, re-transplant (`Z94.x` history) |
| Donor type | procedure qualifier / acquisition rev codes | living vs deceased |
| Complications | secondary dx | rejection `T86.x`, infection, CC/MCC flags |
| Code set | all dx + procedures | kept as a bag for fine-grained overlap |

Most of this is **deterministic lookup tables + CCSR grouping — rules, not
ML.** Auditable and explainable, which matters for claims.

**3. Represent for matching (two complementary ways):**
- **Structured facet vector** (organ, indication, procedure, donor,
  complications) → drives the interpretable two-layer scoring and the
  explainable lens/chip UI.
- **Code-set overlap** (Jaccard / weighted, or clinical code embeddings) →
  catches nuance the facets miss (shared comorbidities, etc.).

**4. Index the corpus identically.** Precompute the same signature for every
historical transplant episode in Teradata *from its own raw codes*, and store
it. Query time = signature-vs-signature, no re-derivation.

**5. Query (the drawer flow, transplant-tuned):**
- **Hard filter:** same organ (kidney↔kidney); optionally donor type.
- **Rank:** indication ●●● · procedure concept ●● · complication overlap ●● ·
  code-set overlap ●.
- **Return** top-N historical episodes, each carrying its **allowed/paid** as the
  benchmark output (DRG added as an extra output field once access is granted),
  with `✓ organ / ✓ indication / ≠ donor` explanations.

---

## 4. Applying the two-layer model to transplant

From `similar-claims-ui-design.md`: scope filters (hard) narrow; similarity
signals (weighted) rank.

- **Scope filter (hard): organ type.** Cross-organ matches are clinically
  useless — a kidney episode isn't similar to a heart episode. Organ is a
  filter, not a soft signal. Optionally also filter donor type (living vs
  deceased drives very different cost/coding).
- **Similarity signals (within organ):**
  - Indication diagnosis (CCSR-grouped) ●●● — same *reason* (ESRD vs polycystic
    vs diabetic nephropathy for kidney).
  - Procedure concept ●● — single vs double lung, SPK, re-transplant.
  - Complication / comorbidity burden ●● — rejection, infection, CC/MCC.
  - Donor type ● (if not filtered).
  - Cost ○ — anchored; useful for outlier/overpayment review, not for finding.

A transplant "Clinically similar" lens = **filter: same organ (+ maybe donor);
weights: indication ●●●, procedure ●●, complications ●●.**

---

## 5. Worked example — a kidney package

```
Package claims:
  UB-04   : dx N18.6 (ESRD), E11.22 ; PCS 0TY00Z0 ; rev 0811 (acquisition)
  CMS-1500: CPT 50360, 50340 ; dx N18.6, Z94.0

→ Signature:
  organ         = kidney            (from 50360 / 0TY00Z0)   ← PCS/CPT, no DRG needed
  indication    = ESRD  (CCSR GEN003)
  procedure     = deceased-donor kidney transplant, recipient
  donor         = deceased          (acquisition + qualifier)
  complications = none

→ Match: corpus kidney episodes, ESRD indication, deceased donor
→ Results carry allowed/paid amounts  ← pricing benchmark
   (MS-DRG 652 added as an extra output field once DRG access is granted)
```

---

## 6. The main real work: episode grouping

Easy to underestimate — this is where the effort actually is:

- **Seed side:** group the package's several claims into one episode before
  building the signature. Easy — the package boundary *is* the episode.
- **Corpus side:** historical claims are stored per-claim, not per-episode. You
  must **link them into transplant episodes** (member + transplant procedure +
  date window spanning eval → admit → follow-up) so you don't match a whole
  package against a single stray line-item claim. Building that episode grouping
  over Teradata is the main data-engineering task; everything else is lookups
  and scoring.

**Robustness to a partial package:** if not all professional claims have
arrived, organ + indication + procedure still resolve from the UB alone. Score
over available facets, normalize, and show a confidence.

---

## 6a. Episode assembly from adjudicated claims (index → donor → all related)

How to pull the full set of related adjudicated claims for a matched patient.
Land the anchors deterministically first, then expand. Order matters: cheapest
and most reliable signals first.

### Step 1 — land the major inpatient (index) claim

> **MS-DRG not used yet.** MS-DRG data is not currently accessible. Detection
> below stands entirely on ICD-10-PCS, CPT, revenue, and diagnosis codes — all
> available on the coded claims today. MS-DRG is wired into the framework as an
> optional confirmatory signal (and as a benchmark output) but stays **disabled
> until DRG access is granted**. Nothing in the current path depends on it.

Filter to institutional inpatient (**Type of Bill `011x`**), then match on the
**primary signal**:

- **ICD-10-PCS root operation `Y` (Transplantation)** — the cleanest single
  signal, present on the inpatient UB. The 3rd character of the PCS code is `Y`
  for every transplant regardless of organ, and the body-system character tells
  you the organ: `0TY..` kidney, `0FY..` liver, `02Y..` heart, `0BY..` lung,
  `0FYG..` pancreas. One rule catches all organs and identifies the organ.

Supporting / cross-check signals (also available today):

- **Transplant CPT/HCPCS** — `50360` kidney, `47135` liver, `33945` heart,
  `32851–54` lung, `48160/48554` pancreas. Confirms the organ and helps when the
  transplant is visible on a professional claim.
- **Organ-acquisition revenue code `081x`** on the inpatient claim (see Step 2).
- **Transplant-status / indication diagnoses** — `Z94.x`, plus the organ's
  indication dx.

Optional (enable when DRG access is available):

- **Transplant MS-DRG** — `652` kidney, `005–006` liver, `001–002` heart,
  `007–008` lung, `010` pancreas, `014/016/017` marrow. Confirmatory only; not
  required to detect the index claim.

If more than one inpatient claim qualifies, "major" = the one carrying the
transplant PCS (and highest charges). Usually there is a single transplant
admission.

### Step 2 — find the donor / organ-acquisition claim

**The donor is a different person than the recipient**, so donor claims CANNOT
be linked by patient ID, and "same hospital" is only a weak signal (deceased-
donor organs are recovered at the donor's hospital by an OPO and shipped;
acquisition costs flow to the transplant center's cost center). Use a separate
**donor linkage track**.

Donor-claim signals: **revenue code `081x`** (`0810` general, `0811` living
donor, `0812` cadaver donor, `0813` unknown, `0814` unsuccessful search, `0815`
cadaver organ(s)) and donor CPT (backbench `50323–50329` kidney / `47143–47147`
liver; donor nephrectomy `50300` cadaver / `50320` living / `50547` lap living).

**It can be both ways** (acquisition bundled on the recipient UB *or* a separate
claim; living-donor care billed under the recipient's coverage *or* standalone),
so **run all linkage rules, union the hits, dedup, and tag each with how it was
linked + a confidence** — don't assume one flow:

| Rule (priority) | How it links | Confidence |
|---|---|---|
| 1. Bundled on index | `081x` lines *inside* the recipient inpatient claim → it IS the index claim | certain |
| 2. Transplant case / auth | a case ID or auth spanning donor + recipient | high |
| 3. Recipient coverage cross-ref | recipient's member/policy is the payer on the donor claim (living donor under recipient benefit), even though the patient is the donor | high |
| 4. Date + code proximity | donor codes (`081x` / donor nephrectomy / backbench) near the index admit date | low — require a second corroborating signal |

Rule 4 alone can pull in an unrelated nearby donor claim — never accept it
without corroboration (case/auth, coverage, or facility).

**Discovery step (because it's unknown):** on a sample of real transplant
episodes, count which pattern actually occurs and how often — bundled vs
separate acquisition, and living-donor-under-recipient-coverage vs standalone.
That tells you which rules carry the weight and where false positives hide, and
lets you tune before trusting the assembly.

### Step 3 — read the anchors off the index claim

From the index claim, extract: **stable patient ID**, **admit/discharge service
dates** (→ episode window), **organ** (from the PCS body-system character), and
the **authorization number(s)**.

### Step 4 — expand to all related claims

Combine three linkage mechanisms (don't rely on any one alone):

1. **Auth linkage** — high-precision seed of the core authorized claims.
2. **Same patient (stable ID) + date-of-service window** — sweeps in the
   untagged tail (labs, ancillary professional, follow-up, readmits).
3. **Transplant-related code filter** — widen/prune by `Z94.x` (transplant
   status), `T86.x` (transplant complications/rejection), and immunosuppressant
   J-codes (`J7525` tacrolimus, `J7517` mycophenolate, `J7520` sirolimus,
   `J7515` cyclosporine, `J7527` everolimus).

### Two corrections to the naive approach

- **Group by date of service, NOT filed date.** Filed/receipt date is
  unreliable (a May service can be filed in August). The episode is defined by
  when care happened — window on date of service / statement-covered period.
- **"Same patient" ≠ "same member ID."** Member IDs change (plan switch, new
  coverage year, subscriber vs dependent). Key on an enterprise/master patient
  ID (MPI) if available, else a composite of member ID + DOB + name (or
  HICN/MBI) tolerant of member-ID changes.

### Auth is an anchor, not the key

An authorization is a utilization-management artifact tied to specific
pre-approved services — not an episode grouper. It does NOT tag all claims:

| Claim | Carries the auth? | Note |
|---|---|---|
| Transplant inpatient (UB) | usually | the authorized event |
| Organ acquisition / donor | often | authorized with the transplant |
| Transplant surgeon (professional) | sometimes | if tied to the auth |
| Anesthesia, pathology, radiology, consults | often not | usually no prior auth |
| Lab (esp. reference labs) | rarely | bill independently |
| Post-transplant follow-up / readmits | often not | new/separate auths |
| Immunosuppression drugs | never (on these forms) | pharmacy benefit (NCPDP) — separate silo |

Also: an episode usually spans **multiple auths** (eval, admit, readmit), not
one — treat "the auth" as a set. And **pharmacy** (immunosuppressants) is a
separate NCPDP data join; auth won't reach it. So use auth(s) to lock the core
with confidence, then expand to the full episode with the DOS window. Auth
*reduces* how much the window must guess; it does not replace it.

### Business decisions to confirm

- **Window lengths** (organ/program-specific): e.g. 30 days pre / 90–180 days
  post; some programs use up to a year post.
- **Total-cost vs transplant-related-only:** all claims in the window (total
  cost of care — simplest, over-inclusive) vs only clinically-tied claims
  (pruned via the Step-4 code filter). Pricing benchmark usually wants all;
  clinical similarity may want the pruned set.
- **Verify on a sample episode:** what fraction of claims actually have the auth
  populated, and is it one auth or several? That tells you how much weight auth
  can carry vs the window.

---

## 7. Reference — transplant coding anchors

Primary detection uses **ICD-10-PCS** (inpatient) and **CPT** (professional).
The MS-DRG column is included for the framework but is **not used until DRG
access is granted**.

| Organ | ICD-10-PCS (primary) | Transplant CPT | MS-DRG (future) | Typical indication (dx → CCSR) |
|---|---|---|---|---|
| Kidney | 0TY00Z0 / 0TY10Z0 | 50360, 50365, 50340 | 650–652 | N18.6 ESRD |
| Liver | 0FY00Z0 | 47135 | 005–006 | K74.x cirrhosis · C22.0 HCC |
| Heart | 02YA0Z0 | 33945 | 001–002 | I50.x HF · I42.x cardiomyopathy |
| Lung | 0BYx0Z0 | 32851–32854 | 007–008 | J84.1 fibrosis · J44 COPD · E84 CF |
| Pancreas / SPK | 0FYG0Z0 | 48160, 48554 | 008, 010 | E10.x diabetes + ESRD |

Donor type: living vs deceased from acquisition revenue/HCPCS codes and PCS
qualifiers. Re-transplant / status: `Z94.x` (transplant status), `T86.x`
(complications of transplanted organ).

---

## 7a. Backend fetch — staged, not one monolithic SQL

A single query for episode assembly + similarity will clog and die. The linkage
mechanisms use **different keys** (recipient = patient ID + DOS; auth = auth
number; donor = `081x` / case / coverage), so one statement means `OR`-ing
across unindexed predicates and multi-way joins over the whole warehouse — the
optimizer can't use indexes, spool blows up, skew, and it runs forever. Ranking
on top of that in the same query is the killer.

Instead, orchestrate **staged, narrowing fetches** in the app tier — each step
small, selective, and index-friendly:

1. **Find the index claim** — one selective query (TOB `011x` + PCS root-op
   `Y`). ~1 row. Fast, indexed.
2. **Read anchors** (app tier, no DB) — patient ID, admit/discharge dates,
   organ, auth(s).
3. **Parallel targeted fetches**, each keyed on ONE thing:
   - **Recipient track** — patient ID + DOS window (one patient, bounded dates).
   - **Auth track** — by auth number(s) (small, exact).
   - **Donor track** — the four rules from Step 2, each its own targeted query.
4. **Merge · dedup · tag** (app tier) — union by claim ID, attach provenance +
   confidence. Not in SQL.
5. **Signature + rank** — separate step, against **precomputed** corpus
   signatures.

### Teradata-specific levers

- **Driver-table pattern.** Stage anchor keys (patient ID, date range, auth
  list, donor keys) into a **volatile/temp table**, then have each fetch *join
  to that small driving set* rather than `OR`-ing predicates across the big
  table. A small driver joined to a big indexed table is what the optimizer
  wants — avoids full scans and spool blowups.
- **Precompute corpus signatures offline** (the single biggest lever). Never
  derive signatures from raw claims at query time. A batch job materializes one
  signature row per historical episode, indexed by organ. Online, similarity is
  a lookup + nearest-neighbor on a small table, not a live warehouse scan.
- **Bounded, cancelable steps.** Each stage has its own timeout and retries
  independently; one slow donor sub-query doesn't kill the assembly — degrade to
  partial results and backfill.
- **Cache the candidate pool.** Fetch candidate episodes once, then re-rank
  lenses/chips in the app tier — no re-query per toggle (see
  `similar-claims-ui-design.md` §9).

Net: a chain of small, index-friendly queries orchestrated by a service, with
intermediate materialization — not one heroic statement that spools itself to
death.

### Dictionary-driven dynamic SQL

SQL is generated at runtime from available data, driven by an existing Teradata
dictionary (logical field → physical column) already used for claims fetch.
Dynamic SQL is the right fit for "match on the intersection of available
fields," but it must reinforce the staged pipeline, not recreate the monolith:

- **Generate SQL per stage, not one adaptive mega-query.** The dictionary tells
  you which linkage keys exist/are populated for this episode; build stage
  3a/3b/3c only for the tracks that actually have keys. Same narrowing pipeline,
  each stage's SQL generated rather than static.
- **Dictionary as the availability gate.** Per field, carry two flags — *exists
  in this source?* and *reliably populated?* Include a predicate/facet only when
  both are true, for BOTH seed and corpus. The field intersection is then
  computed from the dictionary, not hardcoded — this is exactly how the
  un-adjudicated / DRG-absent case is handled: DRG isn't "available," so the
  builder omits it, no special-casing.
- **Parameterize; don't concatenate literals.** Build the SQL *structure*
  dynamically but pass values via `USING` / bind variables. Teradata caches
  request plans keyed on SQL text — inlined literals (a patient ID or date per
  call) churn the plan cache and re-parse every time; bind variables let the
  same generated shape reuse its plan, and close the injection door.
- **Code sets in reference tables, not runtime `IN (...)` lists.** Keep
  transplant codes in a lookup table (`code, code_type, organ, role`) and have
  the generated SQL JOIN to it. Don't emit a 200-element `IN` list — it bloats
  SQL text, defeats plan reuse, and can hit statement-size limits. Combine with
  the volatile driver-table pattern: stage keys once, join generated fetches to
  them.
- **Tag generated queries** (query banding) so each stage is attributable in
  DBQL — dynamic SQL is harder to govern, and per-stage cost visibility matters
  when one episode's fetch misbehaves.

Open items on the dictionary itself: (a) does it carry populated/quality flags
per field/source, or only logical→physical mapping? (b) does the layer already
parameterize, or build SQL by string concatenation? These decide how directly
the intersection logic can key off the dictionary and how much the plan-cache /
injection guidance applies.

---

## 7b. Research feature — embedding the episode benchmark in the review UI

This capability is surfaced as a **research feature** inside the existing
transplant package review screen (the navigator + coverflow + captured-data /
source-PDF split from `pdf-packet-review-design.md`). It is decision-support /
reference for pricing an un-adjudicated package — clearly labeled *research*,
not an automated determination (important for the audit trail).

### Placement — a package-level header, not a panel

The existing review screen has three panels, each scoped narrower than this
action:

- Navigator = per document *group*
- Captured data + Source PDF = per *claim*
- Research = per *whole package / episode*

So it does not belong in any existing panel. Add a **full-width package header
bar** above the navigator + main area, carrying the package identity (patient,
organ, claim count, un-adjudicated status — currently missing from the screen)
and, on the right, a **`Research similar episodes`** button. The three panels
are untouched.

- **Contextual visibility:** show the Research button only for claim/transplant
  packages worth benchmarking; it is meaningless for a generic document packet.
  The header identity is always useful; the action is conditional on package
  type.
- **Alternatives** if a top bar doesn't fit the chrome: pin the button to the
  navigator footer (the rail also represents the whole package), or a
  stage-based "Research" tab. Header bar preferred — most discoverable and it
  fills the missing package-identity gap.

### Interaction — a drawer over the packet, NOT expand-below

Clicking the button opens a **right-side drawer** (same paradigm as the
per-claim similar-claims drawer); the packet review dims behind a scrim and
stays on screen.

Why not expand-below: the header spans full width, so expanding beneath it
pushes the entire workspace (navigator + coverflow + captured data + PDF) down
and off-screen — you lose the very package you're benchmarking against, and the
research content is tall (long-scroll hybrid page). The drawer overlays without
destroying layout and keeps the package visible.

- Use a drawer when research happens **while** reviewing (glance, keep working)
  — the default.
- Use a dedicated **"Research" view/tab** only if it's a separate "leave and
  come back" task. Expand-below is acceptable only as a *small peek* (benchmark
  number + top 3, with "see all" opening the drawer).
- On narrow / mobile screens the drawer becomes a full-screen sheet. Drawer
  width ~55–65% — the benchmark metrics and episode rows need the room.

### Drawer contents (top to bottom)

1. **Derived episode signature — editable, with confidence.** Shows what the
   package rolled up into (organ, indication, procedure, donor, complications).
   Extraction from scanned claims isn't perfect and this signature is *the*
   search input, so the examiner confirms/corrects it before trusting results.
2. **Pricing benchmark — the headline output.** Median allowed, P25–P75 range,
   and n across the matched episodes. Since the goal is pricing an un-adjudicated
   package, the benchmark is the answer; the ranked list below is the evidence.
3. **Organ-locked filter + lens.** A visible `🔒 Kidney` chip makes the hard
   scope filter explicit (kidney benchmarked only against kidney), with lenses
   (Clinically similar) refining within it.
4. **Ranked historical episodes.** Each shows organ · indication · donor ·
   allowed amount, a match %, self-explaining reason chips
   (`✓ organ / ✓ indication / ≠ complications`), and **`Compare ↗`** →
   episode-level side-by-side diff (this package vs the historical episode).

This reuses the drawer, lens/scope, explainability, and diff patterns from
`similar-claims-ui-design.md`, specialized to the episode level.

### Iconography and styling (keep consistent with the other screens)

The research feature must look and feel identical to the packet review and the
similar-claims drawer — same icon set, same tokens, same page styling. Do not
introduce a new visual language for it.

**Icons — Tabler outline only** (never `-filled` variants; they render blank):

| Element | Icon | Notes |
|---|---|---|
| Research feature trigger | `ti-flask` | the header button and drawer title |
| Organ-locked scope filter | `ti-lock` | on the `🔒 Kidney` chip |
| Lens · Clinically similar | `ti-stethoscope` | |
| Lens · Financially similar | `ti-currency-dollar` | |
| Compare / pivot to diff | `ti-arrow-up-right` (↗) | trailing arrow on the button |
| Close drawer | `ti-x` | secondary text color |
| Edit signature | `ti-edit` (or plain "edit" link) | on the derived signature |
| Claim/document covers | `ti-file-invoice` · `ti-photo` · `ti-id` · `ti-clipboard-text` · `ti-receipt` · `ti-notes` | reuse the packet-review cover icons |
| Match reason — matches | `✓` | on `--bg-success` / `--text-success` |
| Match reason — differs | `≠` | on `--surface-1` / `--text-secondary` |
| Value higher / lower (diff) | `↑` / `↓` | inline with the differing value |

Icon usage: 11–20px inline; icons inherit color + size from the parent;
decorative icons get `aria-hidden="true"`; icon-only buttons get an
`aria-label`. See also `similar-claims-ui-design.md` §8 (shared icon table).

**Page / component styling — the shared design system:**

- Flat surfaces, no gradients/shadows beyond functional elevation. Cards:
  `var(--surface-2)`, `0.5px solid var(--border)`, `12px` radius; controls use
  `var(--radius)`.
- **Metric cards** for the benchmark numbers (`var(--surface-1)`, no border,
  small muted label above, larger value below) — same as elsewhere. Round every
  displayed number.
- **Status badges** (verified / needs review / low quality; match %) use the
  role tints: `--bg-success/-warning/-danger` with the matching `--text-*`.
- **Accent** (`--bg-accent` / `--text-accent`) reserved for the research/primary
  affordances (the header button, active lens, organ-lock chip).
- The **drawer + scrim** is the same component as the similar-claims drawer; the
  claim **covers** reuse the designed-cover cards from
  `pdf-packet-review-design.md` §4a.
- Sentence case everywhere; two font weights (400 / 500); text on colored fills
  uses the darker shade of the same family, never plain black/gray.

---

## 8. Open questions to lock the build

1. **Is the corpus already episode-grouped**, or is per-claim all we have (i.e.
   do we build the episode linkage over Teradata)?
2. **Which grouper for diagnoses** — plain CCSR, or an existing licensed grouper
   to reuse?
3. **Confirm the corpus stores raw codes** on each historical claim (so its
   signature is computed the same raw way as the seed).
4. **Donor acquisition pattern** — is it bundled on the recipient UB (rev
   `081x`) or filed as separate acquisition claims? (Can be both — measure the
   mix; see Step 2 discovery.)
5. **Living-donor billing** — are donor claims billed under the recipient's
   coverage (recipient member ID present) or fully standalone under the donor?
6. **Is there a transplant case/auth ID** that spans donor + recipient (the
   cleanest donor link)?
