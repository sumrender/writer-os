# Writer OS — Benchmark & Testing Framework

**Status:** Design settled · assertion authoring pending (human-owned)
**Vocabulary:** See `CONTEXT.md` → "Benchmarking" (fabrication, omission, fixture book, assertion set, extraction, perturbation chapter, control chapter, beat)

---

## 1. Why this exists

PRD §2 makes consistency the core differentiator, but nothing yet verifies the pipelines work: that the Story Bible reflects its source without **fabricating** (facts unsupported by source) or **omitting** (missing established facts), that the Consistency Checker catches real violations without over-flagging, and that chapter generation stays consistent with assembled context.

This framework tests three axes against **fixture books** — public-domain novels stored in-repo, so every claim about them is verifiable by chapter citation.

## 2. Scope & build order

| Axis | Input | Output graded | Sequence |
|---|---|---|---|
| 1. Extraction | fixture chapters, fed sequentially | Story Bible | **first** |
| 2. Consistency checker | perturbation + control chapters | flags raised / not raised | second |
| 3. Generation fidelity | context through ch. N | generated ch. N+1 | last |

All three share schemas and fixture formats from day one. Extraction goes first because its output feeds the other two.

## 3. Repository layout

```
benchmarks/
  books/
    gullivers-travels/
      source/            # raw chapter text files
      manifest.json      # maps files → chapter ordinals
      assertions.yml     # the assertion set (hand-authored)
      beats.yml          # per-chapter beat declarations (axis 3)
      perturbations/     # edited chapters + annotations (axis 2) — TODO
    tom-sawyer/
      …same shape…
  src/                   # runner, extractor harness, graders, schemas
  results/               # gitignored — never committed
```

CLI sketch: `bench run --book tom-sawyer --axis extraction [--runs <n>] [--pipeline <live|fake>] [--judge <stub|live>]`. The pipeline port now has real vendor-backed implementations on by default (`lib/agnes-*`); `--pipeline fake` pins the deterministic fakes for offline runs.
Stack: TypeScript, Agnes AI vendor client (ADR-0004), files on disk — no database dependency.

## 4. Fixture book format

```json
{
  "book": "tom-sawyer",
  "title": "The Adventures of Tom Sawyer",
  "source": "Project Gutenberg #74",
  "chapters": [
    { "ordinal": 1, "file": "source/ch01.txt", "label": "CHAPTER I" },
    { "ordinal": 2, "file": "source/ch02.txt", "label": "CHAPTER II" }
  ]
}
```

Rules:
- Ordinals are contiguous from 1 and are **the** versioning key (ADR-0003). Every assertion's `evidence` / `as_of` refers to them.
- Extraction consumes chapters sequentially in ordinal order (mirrors serialization; enables "as of chapter N" assertions).

Sources: Tom Sawyer = Project Gutenberg #74 · Gulliver's Travels = Project Gutenberg #829.

## 5. Assertion set format (axis 1 — extraction)

Typed union mirroring Story Bible entity kinds (PRD §5.2). Every assertion carries:

| Field | Meaning |
|---|---|
| `id` | stable slug |
| `kind` | `character` \| `appearance` \| `relationship` \| `item` \| `thread` \| `world_rule` \| `timeline` \| `lexicon` \| `style` |
| `expect` | `must` (absent ⇒ omission) or `must_not` (present ⇒ fabrication) |
| …kind-specific fields… | `name`, `from`/`to`/`type`, `item`/`holder`, `thread`/`status`, `term`, `field`/`value`, `topic`, `sequence` |
| `as_of` | optional chapter ordinal; default = final ordinal. Assertion is graded against bible state at that ordinal |
| `evidence` | chapter ordinals establishing the claim |
| `note` | rationale / review guidance |

### Example

```yaml
book: tom-sawyer
assertions:
  # --- character ---
  - id: char-tom
    kind: character
    expect: must
    name: "Tom Sawyer"
    evidence: [1]

  # --- appearance field ---
  - id: app-tom-fence-whitewash
    kind: appearance
    expect: must
    character: "Tom Sawyer"
    attribute: "typical clothing"
    contains: "boy's country clothes"
    evidence: [1, 8]

  # --- relationship ---
  - id: rel-polly-tom-aunt
    kind: relationship
    expect: must
    from: "Aunt Polly"
    to: "Tom Sawyer"
    type: aunt
    evidence: [1]

  # --- negative probe: guards a plausible confusion ---
  - id: rel-polly-tom-not-mother
    kind: relationship
    expect: must_not
    from: "Aunt Polly"
    to: "Tom Sawyer"
    type: mother
    evidence: [1]
    note: Guardianship ≠ maternity; common extraction error.

  # --- item with a state change ---
  - id: item-treasure-holder
    kind: item
    expect: must
    item: "the treasure ($12,000 in gold)"
    holder: "Tom and Huck, jointly"
    as_of: 35
    evidence: [34, 35]

  # --- plot thread lifecycle ---
  - id: thread-injun-joe-menace
    kind: thread
    expect: must
    thread: "Injun Joe as lurking menace"
    status: resolved
    as_of: 33
    evidence: [9, 25, 32, 33]

  # --- world rule: for a realist novel, absence IS the test ---
  - id: rule-no-supernatural-system
    kind: world_rule
    expect: must_not
    topic: "any supernatural / magic system"
    note: Realist fiction — any extracted magic system is fabrication.

  # --- timeline ordering ---
  - id: order-fence-before-cave
    kind: timeline
    expect: must
    sequence: ["whitewashing the fence", "lost in McDougal's cave"]
    evidence: [2, 31]

  # --- lexicon ---
  - id: lex-injun-joe
    kind: lexicon
    expect: must
    term: "Injun Joe"
    locked_spelling: true
    evidence: [9]

  # --- style ---
  - id: style-narration
    kind: style
    expect: must
    field: pov_and_tense
    value: "third-person omniscient, past tense"
    evidence: [1]
```

### Authoring rules (for the human writing these)

1. Every `must` cites evidence ordinals; the review pass re-reads those chapters before approving.
2. Negative probes (`must_not`) should target plausible confusions — aim for ≥15% of the set.
3. Coverage floors per book (starting points, revisit after first baseline): characters ≥10 · relationships ≥12 · items ≥6 · threads ≥5 · timeline ≥5 · lexicon ≥10 · style ≥4 · world_rule ≥2 · appearance ≥6.
4. Assert names exactly as the bible should preserve them (source spellings).

## 6. Grading (axis 1)

Pipeline: extractor emits strict-schema JSON → **deterministic checks first** (exact fields: names, holders, statuses, spellings, statuses-as-of) → **LLM judge only** where values differ superficially but may be semantically equivalent ("half-brother" vs "brother").

**Judge contract (hard rule):** the judge receives the two values plus a fixed rubric and answers only "equivalent or not." It never decides what the book says — ground truth lives exclusively in the assertion set.

**Open-world sweep:** every generated fact not matched by any positive assertion is judged against the source text for support. Catches unanticipated fabrications; reported separately as an estimate (it is judge-mediated, not exact).

**Scoring:** per-kind precision/recall/F1. Failed `must` = omission; triggered `must_not` = fabrication; unmatched-and-rejected sweep findings = estimated fabrication rate.
**Gates:** global precision floor + per-kind recall floors. Start lenient (baseline-establishing), tighten after first baselines exist.

## 7. Axis 2 — checker fixtures (perturbation chapters)

Each perturbation is a copy of a real fixture chapter with deliberate edits, plus an annotation:

```yaml
# books/tom-sawyer/perturbations/ch09-item-swap.yml
base_ordinal: 9
edits:
  - description: "Injun Joe's knife replaced with a revolver"
violates: [item-knife-holder, lex-period-weaponry]   # assertion ids
expect: flag
```

Controls are unmodified chapters with `expect: no_flags`. Flag outcomes grade must-flag / must-not-flag; controls measure the false-positive rate (the §7 over-flagging risk in the PRD).

Suggested edit types: swap an item's holder · contradict a relationship · resurrect/dead-wrong a character's status · misspell a locked lexicon term · violate a timeline ordering.

> **TODO (human):** hand-edit selected chapters into `perturbations/` with annotations. Not started.

## 8. Axis 3 — generation fidelity

Two independent grades per generated chapter N+1:

1. **Beat assertions** (`beats.yml`) — creative divergence is fine unless it omits a required beat or contradicts canon:

```yaml
chapters:
  - ordinal: 11
    beats:
      must_include:
        - "Tom and Huck swear the blood oath"
      must_not_include:
        - "the murder is reported to the authorities"
```

2. **Checker-mediated** — assemble context through N per the pipeline's assembly rules, generate N+1, run the checker, expect zero factual flags. Measures context assembly end-to-end.

They fail for different reasons: beats fail on content fidelity; checker-mediation fails on assembly.

## 9. Running the benchmark yourself

### 9.1 One-time setup

```sh
# from the repo root
cd benchmarks
pnpm install
pnpm build                 # compiles dist/ (runs import dist/, tests import src/)

# credentials — create benchmarks/.env (gitignored; never commit or log it):
#   AGNES_API_KEY=<your key>
#   AGNES_BASE_URL=https://apihub.agnes-ai.com/v1
```

Sanity-check connectivity without spending a full run:

```sh
node scripts/probe-agnes.ts     # plain completion + forced-tool verdict (~2 calls)
node scripts/probe-extract.ts   # live-extracts one mini-book chapter (~1 call)
```

Expect `plain completion: "READY"` and a verdict JSON line. Anything else → check `.env` first.

### 9.2 Commands

All commands run from `benchmarks/`. Default protocol is **3 runs**, **live pipeline** (real Agnes calls), **live judge**; `--pipeline fake --judge stub` gives the fully offline deterministic reference (no network, no key needed).

```sh
# validate fixtures without any model calls
node dist/runner/cli.js list
node dist/runner/cli.js validate --book tom-sawyer

# single axis, single book (the core command)
node dist/runner/cli.js run --book tom-sawyer  --axis extraction --judge live
node dist/runner/cli.js run --book gullivers-travels --axis extraction --judge live
node dist/runner/cli.js run --book tom-sawyer  --axis checker    --judge live
node dist/runner/cli.js run --book gullivers-travels --axis checker    --judge live
node dist/runner/cli.js run --book tom-sawyer  --axis generation --judge live
node dist/runner/cli.js run --book gullivers-travels --axis generation --judge live
```

Useful flags:
- `--runs 1` — cheap probe before paying for the full protocol
- `--pipeline fake` — offline deterministic pipeline
- `--cache true|false` — caching toggle, **default `true`**. Every run always announces the active state as its first output line (`cache: ENABLED …` / `cache: DISABLED …`, stderr in `--format json` mode) so cached-vs-fresh provenance is unambiguous from the log alone. `false` forces every model call — judge verdicts *and* extractions — to reach the API fresh; nothing persists.
- `--format json` — stdout = pure JSON report (validation chatter → stderr)
- `--gates gates.json` — custom floors `{"global_precision_min":0..1,"recall_min":{"character":0..1}}`
- `AGNES_MIN_INTERVAL_MS=5000 node …` — widen rate-limit spacing if you hit 429s

**Run everything, both books, all axes** (sequential; logs everything):

```sh
./scripts/run-all-books.sh                # caching ON (default)
BENCH_CACHE=false ./scripts/run-all-books.sh   # fully fresh, fully paid
```

The script **always** prints and records the cache state ("CACHE is ENABLED …" / "CACHE is DISABLED …"), forwards it to every run via `--cache`, and stamps it into each `index.txt` START line (`cache=true|false`).

Recommended entry point: tom-sawyer then gullivers-travels, extraction → checker → generation each, writing one timestamped log per run under `results/runs/<UTC-stamp>-<book>-<axis>.txt` plus an append-only ledger (`START`/`END` lines with exit codes) in `results/runs/index.txt`. Review afterwards via `cat results/runs/index.txt`, then open the log of interest.

### 9.3 What gets cached vs. paid (rate limits!)

Agnes free tier allows ~20 executable requests/min. The client spaces request *starts* 3500 ms apart and retries 429/5xx with exponential backoff, so runs are slow but stable.

| Call class | Cached? | Where |
|---|---|---|
| Judge verdicts (equivalence + sweep) | ✅ content-hash | `results/cache/judge-cache.json` |
| Extraction responses | ✅ content-hash | `results/cache/extract-cache.json` |
| Bible synthesis responses | ✅ content-hash (key folds in the strategy, so per-section and monolithic never collide) | `results/cache/synthesis-cache.json` |
| Checker flags | ❌ fresh every run | — |
| Generated prose | ❌ deliberately never (sampled prose is the thing measured) | — |

Practical consequences:
- A crashed/restarted run re-pays only check/generate work, not extraction.
- Cache keys include exact prompts + tool schema: any prompt change invalidates them automatically, so caching can never serve stale output as new measurement.
- Delete files under `results/cache/` to force a fully fresh (paid) rerun.

### 9.4 Runtimes to expect

Approximate wall-clock at default spacing on the free tier:

| Command | Cold cache | Warm extraction cache |
|---|---|---|
| mini-book extraction, per-section (default), 1 run | ~10 min (observed 630 s — 12 section calls/chapter at 3.5 s spacing, plus self-healing retries) | ~1 min (observed 48 s) |
| mini-book extraction, monolithic, 1 run | ~4–5 min (observed 261 s — one assembly call/chapter) | ~3 min (observed 184 s — synthesis keys re-paid when cached extractions differ from the cold run's, see §9.7 temp-0 variance) |
| mini-book, checker / generation axes | ~4–6 min | ~2–4 min |
| tom-sawyer extraction (36 ch × 3 runs) | ~40–60 min | ~1–2 min |
| gullivers-travels extraction (39 ch × 3 runs) | ~60–90 min | ~1–2 min |
| Real-book checker axis, 3 runs | ~45–70 min | ~15–25 min |
| Real-book generation axis, 3 runs | ~20–35 min | ~15–30 min |
| Full `run-all-books.sh`, cold cache | **~3–5 h** | safest to leave chained unattended |

Long runs background cleanly (`nohup ./scripts/run-all-books.sh > results/runs/chain-stdout.txt 2>&1 &`); progress is observable at any moment via `results/runs/index.txt`.

### 9.5 How to read the reports

Every axis prints mean ± variance across runs (pure JSON with `--format json`). Exit code `0` = gates passed; nonzero = validation or gate failure.

**Extraction** — per-kind precision/recall/F1, e.g.:
```
extraction — tom-sawyer (runs: 3)
  character       precision 0.973 ±0.001  recall 0.812 ±0.004  f1 0.886 ...
  global precision 0.95 (floor 0.500)
  open-world sweep: swept 24.0/run, 1.33 unsupported → estimated fabrication rate 0.04 ±0.01
  gates: PASS
```
Reading it: precision high + recall lower ⇒ model finds most facts but misses some asserted ones (see which kinds). Precision below floor ⇒ asserted-fact fabrication or over-strict equivalence judging. Recall zeros on rare kinds (`lexicon`, `thread`) in classic prose are common baseline findings, not harness errors. The fabrication rate is a judge-mediated **estimate**, deliberately reported separately.

**Checker** — deviating cases print their actual flag text beneath the rate:
```
  control     ch02-control   expect no_flags false-positive rate 1.000
      flag: Style guide sets narration to 'close third person…' …
```
A flagged control shows exactly what was flagged — always read this first when `gates: FAIL`.

**Generation** — failing chapters print missed/violated beat text and checker flag messages:
```
  chapter 10  … pass rate 0.333
      missing beat: Tom and Huck flee the graveyard
```

### 9.6 Known live baselines (mini-book · agnes-2.5-flash)

Recorded honestly from live runs; treat as vendor-model characterizations, not harness bugs:

| Axis | Result | Diagnosis |
|---|---|---|
| Extraction (per-section, cold) | **PASS** — global precision 1.000; F1 gaps on `appearance`/`location`/`thread` | Model omits whole kinds in tiny chapters; lenient gates absorb it. `location` recall 0 is the same omission pattern (the model rarely emits a location fact in a 4-chapter fixture), not a harness bug |
| Extraction (monolithic, cold) | **PASS** — same global precision 1.000 | Dual-mode confirmed under live: both strategies produce valid bibles end-to-end |
| Checker | FAIL — perturbation catch 1.000 but control FP 0.500 | Model treats quoted *dialogue* as contradicting a narration-*style* fact, beyond its written contract ("never flag stylistic variation"); prompt-contract sharpening pending |
| Generation | FAIL — chapter 4 beats omitted in all 3 sampled drafts | Genuine prose-fidelity gap; exact missing beats visible via §9.5 evidence lines |

Real-book baselines accumulate under `results/runs/` — check `index.txt` for completed runs; report shapes are identical to §9.5.

### 9.7 Trust-boundary hardening baked into the live ops

The real model emits structured-output noise Agnes cannot schema-enforce (forced-tool parameters are one flat schema; no JSON-schema response mode). The ops therefore: canonicalize documented noise classes (stray cross-kind fields dropped; missing `kind` inferred only when fields resolve uniquely to one kind; thread-identity-under-`name` and bare-character mentions normalized); attach the raw payload snippet (`near: {…}`) to every validation rejection so failures are diagnosable from run logs alone; retry once with the validator error fed back before propagating failure. Genuinely ambiguous payloads still hard-fail — nothing silently reaches canon state.

Locations are the strongest case of the "derive, don't ask" principle (issue #21): `charactersSeen` is a deterministic co-occurrence computation over the chapter texts (`bible-locations.ts` is its single source of truth), so the grounding validator **overwrites** whatever the model emitted for it with the derivation — the model's list is discarded, never consulted. The model owns only the prose (`description`, `significance`) and the choice of which canon places to describe; the one model-authored field still policed is the place name (an entry naming a place the location facts never establish is rejected). Demanding the model *reproduce* the derivation instead (the original #17 design) caused cold-run hard failures: the model cannot reliably emit exact ordinals for a regex computation, and unlike prose sections the mistake was not self-healable by retry.

Observed live noise classes on `agnes-2.5-flash` (all self-healed by the one-retry mechanism in the issue-#21 verification runs — 3 retries cold per-section, 1 cold monolithic, both green): invented `threadRollups` when canon establishes no threads; omitted/non-integer `firstAppearanceOrdinal` in character profiles; world `classification` contradicting a deviating rule; invented location names, including case variants of a canon name (`"Northern Light"` vs canon `"northern light"`). Caveat: despite temp 0, model output varies run to run — a retry can fail with a *different* error than the first attempt (one pre-fix monolithic cold run died this way), so occasional hard failures on non-locations sections remain a vendor-model characteristic, not a harness defect.


## 10. Open items

- [x] Download source texts, split into chapters, write manifests (both books)
- [x] Author assertion sets (both books) — human-authored, present for tom-sawyer + gullivers-travels
- [x] Edit perturbation chapters + annotations (§7) for tom-sawyer and gullivers-travels (2 perturbations + 2 controls each); mini-book's done
- [x] Declare beats per chapter (§8) — 4 beat chapters per real book authored
- [x] Live pipeline ops (extract/check/generate) + live judge wired behind `pipeline.ts`; live verification of all three axes completed on mini-book
- [ ] Sharpen checker prompt contract after §9.6 control-FP finding (dialogue vs style contradiction)
- [ ] Record real-book baseline numbers from `results/runs/` once full protocols complete
- [ ] Tighten gate thresholds after first real-book baselines exist
