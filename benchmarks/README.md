# Writer OS — Benchmark workspace

Dev-facing evaluation suite: runs fixture books through Writer OS pipelines and grades outputs against assertion sets. Vocabulary in `../CONTEXT.md` → "Benchmarking"; design in `../docs/TESTING.md`. Never a product surface.

## Layout

```
benchmarks/
  src/            runner CLI, manifest validation (tests beside modules)
  scripts/        build-books.ts — regenerates fixtures from Project Gutenberg
  books/          committed fixture books (source chapters + manifest.json)
  dist/           compiled CLI (gitignored)
  results/        run output — gitignored, never committed
```

Fixture-side machinery beside `src/lib/`:

- `lib/assertions.ts` — typed assertion-set schema (nine entity kinds, `must`/`must_not`, `as_of`, evidence) with a validator that rejects malformed sets precisely
- `lib/assertion-file.ts` — loads and validates a book's `assertions.yml`
- `lib/pipeline.ts` — the pipeline-under-test port: `extract(chapterText, ordinal, bibleSoFar)`, `check(bibleStateAsOf, chapterText)`, `generate(context, intent?)`, all strict-structured on both boundaries
- `lib/fakes.ts` — deterministic rule-based implementations of all three ops
- `lib/extraction-run.ts` — drives extraction sequentially over a book, snapshotting the bible state after each ordinal
- `lib/fact-text.ts` — renders structured bible entries as keyed fact descriptors
- `lib/assertion-match.ts` — assertion↔bible matching: exact checks first; judgable fields (relation types, descriptions, topics, event wording) route to the equivalence judge on `must` assertions only — names, holders, statuses, and spellings never depend on a model's opinion
- `lib/grader.ts` — grades an assertion set against snapshots: satisfied `must` = TP, missed `must` = omission, triggered `must_not` = fabrication; claims matched facts by content key
- `lib/sweep.ts` — open-world sweep: facts no positive assertion claimed get judged against the source text; yields an *estimated* fabrication rate reported separately from exact scores
- `lib/judge.ts` / `lib/stub-judge.ts` / `lib/live-judge.ts` — the judge seam: equivalence-only verdicts per ADR-0005 (two values + fixed rubric in, equivalent-or-not out, never fixture text); a scripted stub keeps runs offline, the Agnes-backed implementation (`agnes-2.5-flash`, forced tool-call verdicts per ADR-0004) shares the identical interface
- `lib/verdict-cache.ts` / `lib/cached-judge.ts` — all judge calls cached by SHA-256 of their canonical input; cache lives under gitignored `results/cache/`
- `lib/metrics.ts` / `lib/gates.ts` — per-kind precision/recall/F1 arithmetic, mean ± variance aggregation, global precision floor + per-kind recall floors (lenient defaults, configurable)
- `extraction-axis.ts` / `report.ts` — the 3-run protocol per book with mean ± variance reporting; text and JSON output print to terminal/CI only

## Commands

```sh
pnpm install
pnpm build                 # compile CLI to dist/
pnpm typecheck             # strict-mode TS across src/ + scripts/
pnpm test                  # vitest
pnpm books:build           # re-download + re-split fixture books (network)

node dist/cli.js validate --book tom-sawyer
node dist/cli.js run --book mini-book --axis extraction
node dist/cli.js run --book gullivers-travels --axis extraction --format json
node dist/cli.js list
```

`run --axis extraction` options:

| Flag | Default | Meaning |
|---|---|---|
| `--runs <n>` | `3` | sequential extraction passes; metrics report mean ± variance |
| `--judge <stub\|live>` | `stub` | scripted offline stub vs Agnes-backed judge (`AGNES_API_KEY`, optional `AGNES_BASE_URL`) |
| `--format <text\|json>` | `text` | human text or machine JSON on stdout (JSON mode keeps stdout pure) |
| `--gates <file>` | lenient | JSON: `{"global_precision_min": 0..1, "recall_min": {"<kind>": 0..1}}`; evaluated on run means |

The registered extraction pipeline is currently the deterministic fake; real pipelines slot into the same port with zero benchmark changes.

Exit codes: `0` ok · `1` fixture validation failure · `2` usage error · `3` requested axis has no registered pipeline yet (validation still ran first) · `4` gate failure (global precision floor or a per-kind recall floor missed).

Run protocol notes: everything a run produces prints to terminal/CI — no artifacts land in tracked paths. Judge calls cache by input hash under `results/cache/` (gitignored, resolved relative to the books root when `--books-root` points elsewhere), so regrades are free. The open-world sweep is judge-mediated and its fabrication rate is an estimate, never mixed into exact scores; the sweep judge reads the whole book per swept fact (fine for fixtures — the cache makes repeats free). With `--format json`, stdout carries only the JSON report; validation chatter moves to stderr. Correctness is proven against `books/mini-book`, whose scores are known by construction — fully offline.

## Fixture provenance

Both books were downloaded from Project Gutenberg and split into chapter files by `scripts/build-books.ts`, which also writes each `manifest.json`. Ordinals are contiguous from 1 — the versioning key (ADR-0003):

- **tom-sawyer** — PG #74, 35 chapters + CONCLUSION (ordinal 36)
- **gullivers-travels** — PG #829, 39 chapters over 4 parts; printed chapter numbers restart per part, so labels carry the part (`Part III: … — CHAPTER II`) while ordinals stay global

To reproduce from local copies instead of the network:

```sh
PG_74_FILE=/path/pg74.txt PG_829_FILE=/path/pg829.txt pnpm books:build
```

To see validation fail on a deliberately corrupted fixture:

```sh
cp -R books/tom-sawyer /tmp/tom-sawyer-broken
rm /tmp/tom-sawyer-broken/source/ch05.txt
node dist/cli.js validate --book tom-sawyer --books-root /tmp   # exit 1, precise error
```

The vendor client (`openai`, pointed at Agnes AI's OpenAI-compatible endpoint per ADR-0004) backs the live judge; the equivalence-only contract it serves is specified in ADR-0005.
