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

## Commands

```sh
pnpm install
pnpm build                 # compile CLI to dist/
pnpm typecheck             # strict-mode TS across src/ + scripts/
pnpm test                  # vitest
pnpm books:build           # re-download + re-split fixture books (network)

node dist/cli.js validate --book tom-sawyer
node dist/cli.js run --book gullivers-travels --axis extraction
node dist/cli.js list
```

Exit codes: `0` ok · `1` fixture validation failure · `2` usage error · `3` requested axis has no registered pipeline yet (validation still ran first).

Axis grading wires up when the pipeline-under-test port lands (issue #7+); until then `run` performs full fixture ingestion/validation and stops. No command in this issue issues an LLM call.

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

The vendor client dependency (`openai`, pointed at Agnes AI's OpenAI-compatible endpoint per ADR-0004) is declared now per spec; nothing imports it yet.
