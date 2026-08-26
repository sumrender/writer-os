# Coding Standards

**Binding for every contribution — human or agent, production code or scripts, no exceptions.** Code that violates this document must not be committed; agents must fix violations before finishing any task, and reviewers must reject them.

## 1. TypeScript everywhere

All code in this repository is written in **TypeScript**, compiled/run under **`strict` mode**.

1. Every implementation file is `.ts` — including build/utility scripts. Plain `.js`/`.mjs`/`.cjs` implementation files must not be created.
2. `tsconfig.json` is the floor, not the ceiling: keep `"strict": true` and the strictness flags already enabled (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`, …). Weakening a flag is a breaking change to this document and requires the owner's explicit approval.
3. Silence no diagnostics. No `@ts-ignore`, no `@ts-expect-error` without an adjacent comment proving the checker is wrong, no `as any`, no unjustified `!` assertions. Where a type genuinely can't be known, parse/validate at the boundary and narrow `unknown` into a precise type.
4. Type the domain precisely: discriminated unions over boolean-flag soup, literal union types over loose strings, exported interfaces for every seam other modules consume.
5. Data crossing a trust boundary (files, network, env vars, CLI args) is validated before use; internal types describe validated data only.

## 2. DRY

Every meaning lives in exactly one place.

1. The same knowledge expressed twice is a defect: extract it into one named function, constant, or module.
2. Duplication of *code shape* is not duplication of *meaning*. Two lookalike blocks that will vary for independent reasons stay separate; forcing them through one abstraction couples things that must not drift together.
3. Derived values are computed, never copied: one source of truth, everything else derives from it at runtime.

## 3. SOLID

1. **Single responsibility** — each module owns one job and one reason to change: parsing, validation, orchestration, and presentation live apart (see `benchmarks/src`: `lib/manifest.ts` validates, `runner.ts` maps results to exit codes, `cli.ts` only wires stdio).
2. **Open/closed** — behavior grows by adding implementations behind an existing interface, not by editing stable cores with new conditionals.
3. **Liskov substitution** — every implementation of an interface honors its full contract, errors included. Fakes and test doubles obey the same contract as real implementations, so callers cannot tell them apart by behavior.
4. **Interface segregation** — consumers receive narrow interfaces carrying only what they use; fat grab-all interfaces must be split.
5. **Dependency inversion** — policy depends on abstractions. Effects (filesystem, stdout, vendor SDKs) enter as injected parameters (`CliIo`-style), keeping cores pure and testable.

## 4. Modular

1. Dependencies point one way: entry point → command/runner layer → library modules. A library module never imports from a higher layer, and nothing imports the entry point.
2. Each module exposes the smallest public surface that serves its seam; helpers stay private (unexported). Reaching across a module's surface to test internals means the seam is wrong — fix the seam.
3. New capability = new module with a typed interface at its boundary, composed from existing ones — not growth of an existing module toward a second responsibility.
4. Tests exercise behavior across public seams (exported functions, CLI exits/output), mirroring how issue specs define "modules under test".

## 5. Enforcement

Before every commit: `pnpm typecheck` and the full test suite pass. An agent finishes a coding task only with both green; a review that finds a violation sends the work back.
