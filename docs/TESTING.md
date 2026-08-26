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

CLI sketch: `bench run --book tom-sawyer --axis extraction`
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

## 9. Run protocol

- 3 runs per book per axis, low temperature; report mean ± variance per metric.
- LLM calls cached by input hash (cache lives under gitignored paths) — regrading is free.
- **No run artifacts are stored**: JSON results and summaries print to terminal/CI and stay gitignored (decided).

## 10. Open items

- [x] Download source texts, split into chapters, write manifests (both books)
- [ ] Author assertion sets (both books) — human-owned, per §5 rules
- [ ] Edit perturbation chapters + annotations (§7) for tom-sawyer and gullivers-travels — mini-book's are done (demonstrates the harness); real-book fixtures remain a human task
- [ ] Declare beats per chapter (§8) — can wait until axis 3
- [ ] Set gate thresholds after first baseline runs
