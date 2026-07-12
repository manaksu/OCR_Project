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
| DRG | no | yes | OUTPUT — what the match tells you |
| Allowed / paid / pricing | no | yes | OUTPUT — the benchmark you're after |

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
- **Return** top-N historical episodes, each carrying its DRG + allowed/paid as
  the benchmark output, with `✓ organ / ✓ indication / ≠ donor` explanations.

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
  organ         = kidney            (from 50360 / 0TY00Z0)
  indication    = ESRD  (CCSR GEN003)
  procedure     = deceased-donor kidney transplant, recipient
  donor         = deceased          (acquisition + qualifier)
  complications = none

→ Match: corpus kidney episodes, ESRD indication, deceased donor
→ Results carry MS-DRG 652 + allowed amounts  ← pricing benchmark
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

Filter to institutional inpatient (**Type of Bill `011x`**), then match on
either signal:

- **ICD-10-PCS root operation `Y` (Transplantation)** — the cleanest single
  signal. The 3rd character of the PCS code is `Y` for every transplant
  regardless of organ, and the body-system character tells you the organ:
  `0TY..` kidney, `0FY..` liver, `02Y..` heart, `0BY..` lung, `0FYG..` pancreas.
  One rule catches all organs and identifies the organ.
- **Transplant MS-DRG** — `652` kidney, `005–006` liver, `001–002` heart,
  `007–008` lung, `010` pancreas, `014/016/017` marrow.

If more than one inpatient claim qualifies, "major" = the one carrying the
transplant PCS/DRG (and highest charges). Usually there is a single transplant
admission.

### Step 2 — find the donor / organ-acquisition claim

The signal is **revenue code `081x`**: `0810` general, `0811` living donor,
`0812` cadaver donor, `0813` unknown donor, `0814` unsuccessful search,
`0815` cadaver organ(s).

Important: acquisition is often billed **as a revenue line on the recipient's
inpatient claim**, not as a separate claim — so check `081x` lines *inside* the
index claim AND for standalone acquisition claims. Supporting signals: donor
CPT (backbench `50323–50329` kidney / `47143–47147` liver, donor nephrectomy
`50300` cadaver / `50320` living / `50547` laparoscopic living).

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

| Organ | MS-DRG (output) | Transplant CPT | ICD-10-PCS | Typical indication (dx → CCSR) |
|---|---|---|---|---|
| Kidney | 650–652 | 50360, 50365, 50340 | 0TY00Z0 / 0TY10Z0 | N18.6 ESRD |
| Liver | 005–006 | 47135 | 0FY00Z0 | K74.x cirrhosis · C22.0 HCC |
| Heart | 001–002 | 33945 | 02YA0Z0 | I50.x HF · I42.x cardiomyopathy |
| Lung | 007–008 | 32851–32854 | 0BYx0Z0 | J84.1 fibrosis · J44 COPD · E84 CF |
| Pancreas / SPK | 008, 010 | 48160, 48554 | 0FYG0Z0 | E10.x diabetes + ESRD |

Donor type: living vs deceased from acquisition revenue/HCPCS codes and PCS
qualifiers. Re-transplant / status: `Z94.x` (transplant status), `T86.x`
(complications of transplanted organ).

---

## 8. Open questions to lock the build

1. **Is the corpus already episode-grouped**, or is per-claim all we have (i.e.
   do we build the episode linkage over Teradata)?
2. **Which grouper for diagnoses** — plain CCSR, or an existing licensed grouper
   to reuse?
3. **Confirm the corpus stores raw codes** on each historical claim (so its
   signature is computed the same raw way as the seed).
