# Benchmark UI is a TanStack Start dev surface, not the product app

The benchmark UI (issue #11) is a local web surface for configuring, running, and inspecting mini-book Extraction benchmarks — watching the Story Bible accumulate chapter by chapter and browsing the grading report. It is dev tooling under `ui/`, never a product surface (per CONTEXT.md's definition of Benchmark). ADR-0001 pins the *product* to a single Next.js + Postgres monolith; this ADR records why the dev surface deliberately does not follow it.

Next.js buys the product its datastore, routing, and deploy story — none of which this tool needs. The UI has no database: it spawns the already-built benchmarks CLI as a child process, reads its NDJSON `events` stream, and persists finished run records as JSON under the gitignored `benchmarks/results/ui-runs/`. TanStack Start was chosen because its server functions give typed, validated RPC from the browser to that Node run-manager without a hand-rolled API layer, its Vite file-based routing keeps the surface to a handful of files, and it shares the workspace's TypeScript. The alternative — bolting the tool onto the product Next.js app — would entangle a throwaway dev harness with the deployable monolith and its datastore assumptions for no benefit.

## Consequences

- The UI is a second workspace member (`pnpm-workspace.yaml`) alongside `benchmarks`; the root `dev`/`typecheck`/`test` scripts prebuild the CLI first because the UI imports the benchmarks package's built `dist` types and its tests spawn the built CLI across a real process boundary.
- The CLI's `events` format is the single seam between the two packages; the UI never imports benchmark internals directly, only the `@writer-os/benchmark/events` subpath. This keeps the child process a genuine trust boundary — every stdout line is narrowed through `parseBenchmarkEvent` before rendering.
- This divergence is scoped to dev tooling. Nothing here changes ADR-0001: the product remains Next.js + Postgres, and this tool is never deployed as a product surface.

## Deliberate strictness deviation

`CODING_STANDARDS.md` §1.2 treats weakening a TypeScript strictness flag as a breaking change requiring the owner's approval; this ADR is that approval, narrowly scoped to `ui/tsconfig.json`. The UI keeps `strict` and `noUncheckedIndexedAccess` but omits `verbatimModuleSyntax`. TanStack Start's own guidance warns that `verbatimModuleSyntax` can leak server-only code into client bundles because it forces `import type` elision semantics that fight the compiler's server/client module splitting. The flag is off for the UI package only; `benchmarks/` keeps it on.
