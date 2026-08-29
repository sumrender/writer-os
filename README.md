# writer-os

Writer OS keeps serialized-fiction prose and character art consistent with a
story's established canon by treating canon as structured, queryable data.
Domain vocabulary lives in [`CONTEXT.md`](CONTEXT.md); architectural decisions
in [`docs/adr/`](docs/adr).

This repo is a **pnpm workspace** with two members:

| Package | What it is |
|---|---|
| [`benchmarks/`](benchmarks) | The Benchmark: a CLI that runs fixture books through Writer OS pipelines and grades outputs against assertion sets. Dev tooling — never a product surface. |
| [`ui/`](ui) | The Benchmark UI: a local web surface to configure, run, and inspect mini-book Extraction benchmarks and browse the generated Story Bible. |

Requires **Node ≥ 22** and **pnpm 10**.

## Quick start — the Benchmark UI

From the repo root:

```sh
pnpm install     # once — installs both workspace members
pnpm dev         # prebuilds the benchmarks CLI, then serves the UI
```

Open **http://localhost:3000**. The form is preconfigured for the **mini-book**
fixture on the **Extraction** axis with the **offline fake pipeline + stub
judge**, so you can start a run immediately — no API key, no spend, fully
deterministic.

What you can do in the UI:

- **Configure a run** — fixture book, axis, sequential run count, pipeline
  (`fake`/`live`), judge (`stub`/`live`), and response caching. Selecting a live
  pipeline or judge surfaces a spend warning and your Agnes credential status.
- **Watch it run** — chapter-by-chapter progress (`n of total`), per-chapter
  timing and Canon entry counts, and a live event feed. Only one run is active
  at a time; you can cancel a running benchmark.
- **Inspect the result** — per-kind precision/recall/F1, gate verdicts with
  floors and values, the open-world Fabrication estimate, Omission/Fabrication
  evidence lines, and the generated **Story Bible** grouped by the nine entity
  kinds with an "as of chapter N" snapshot switcher.
- **Reopen past runs** — finished runs persist as JSON under
  `benchmarks/results/ui-runs/` (gitignored) and reload instantly, surviving
  dev-server restarts.

### Running against the live model (optional)

The offline path needs nothing else. To exercise the live Agnes pipeline/judge
from the UI, provide a key the same way the CLI does — the child process loads
`benchmarks/.env`:

```sh
cp benchmarks/.env.example benchmarks/.env   # then paste your AGNES_API_KEY
```

Then flip Pipeline or Judge to `live` in the form. Live mini-book runs are
cheap: four chapters plus grading.

## Quick start — the CLI

The UI drives the compiled CLI under the hood (`pnpm dev` builds it for you).
To run benchmarks directly, see [`benchmarks/README.md`](benchmarks).

## Everyday commands (repo root)

```sh
pnpm dev         # build the CLI, then run the UI dev server (http://localhost:3000)
pnpm build:cli   # compile the benchmarks CLI to benchmarks/dist
pnpm typecheck   # strict TS across both packages (builds the CLI first)
pnpm test        # full suite: benchmarks + UI (builds the CLI first)
```

The UI's integration tests spawn the **real built CLI** across a process
boundary (offline fake/stub), which is why `typecheck` and `test` prebuild it.
