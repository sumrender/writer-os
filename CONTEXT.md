# Writer OS

Domain language for Writer OS: a SaaS that helps serialized-fiction writers keep both their prose and their character illustrations consistent with a story's established canon by treating canon as structured, queryable data.

## Language

### Story & canon

**Story Facts**:
The graded fact store: atomic, per-chapter, source-verifiable canon facts, versioned as of chapter N (ADR-0007: the fact layer of the two-layer canon). Not a readable document — the readable derivation is the Story Bible.
_Avoid_: bible state, fact dump, Story Bible (that is the synthesized document, a different layer)

**Story Bible**:
The author-facing reference document synthesized from Story Facts plus chapter prose: overview, character and location profiles, chapter summaries, plot-thread rollups, timelines, and more. A derivation, never the store of facts itself (ADR-0007: the synthesized layer of the two-layer canon).
_Avoid_: lorebook, lore document, bible file

**Canon**:
The body of facts a story has established, as represented in the Story Facts at a given point in manuscript progress — the fact layer of the two-layer canon (ADR-0007).
_Avoid_: lore, truth

**Canon change**:
A writer-approved modification to established canon, typically proposed by the system from new chapter content. Never applied silently.
_Avoid_: auto-update, sync

**Retcon**:
An intentional canon change that contradicts previously published chapters. Marks a chapter correct while flagging all earlier chapters that assumed the old fact, for the writer's awareness.
_Avoid_: rewrite (retcons do not trigger automatic rewriting)

**Chapter ordinal**:
A chapter's position in the story's manuscript order as tracked inside Writer OS. The single ordering key for all "as of chapter N" state queries.
_Avoid_: chapter number (ambiguous with external platforms' numbering)

**In-world timeline**:
A story's internal chronology, kept as Story Facts. Used by generation and checking; never used as the key for canon-state version lookups.

**Published (in Writer OS)**:
A chapter's status after passing the Consistency Checker with the writer's approval of proposed canon changes. Internal to Writer OS; distinct from exporting/copying to an external platform.

### Benchmarking

**Benchmark**:
A dev-facing evaluation suite that runs Writer OS pipelines over fixture books and grades outputs against an assertion set. Never a product surface.
_Avoid_: eval harness, test suite (ambiguous with code tests)

**Fixture book**:
A public-domain novel stored in-repo with a chapter manifest mapping its text to chapter ordinals, serving as standardized benchmark input.
_Avoid_: test book, corpus

**Assertion set**:
The typed, human-verified claims encoding a fixture book's ground truth: facts that must exist, facts that must not exist, and intermediate states, each citing evidence chapter ordinals.
_Avoid_: golden bible (that rejected form has no polarity or evidence), ground truth file

**Extraction**:
Building Story Facts incrementally from finished chapter prose, chapter by chapter in manuscript order — the fact layer of the two-layer canon (ADR-0007), graded directly; the Story Bible is synthesized from it, never graded. Currently benchmark-internal; distinct from the deliberately deferred import feature.
_Avoid_: import (reserved for a future product surface), ingestion

**Fabrication**:
An output fact the underlying source does not support. Counts against precision.
_Avoid_: hallucination, made-up fact

**Omission**:
A source-established fact an applicable assertion requires that the output lacks. Counts against recall.
_Avoid_: missed fact, gap

**Perturbation chapter**:
A fixture chapter deliberately edited to violate specific, annotated canon facts; the checker must flag it.
_Avoid_: violation chapter

**Control chapter**:
An unmodified fixture chapter the checker must pass untouched; measures false flags (over-flagging).
_Avoid_: clean chapter

**Beat**:
A discrete narrative event. Chapter-intent inputs and next-beat suggestions operate on beats; in benchmarks, a required beat declared for a fixture chapter is one a faithful generation must contain.
_Avoid_: scene (a scene may span several beats)

### Metering

**Chapter generated**:
A billable event recorded for every chapter-draft generation call, including section regenerations and tone nudges.

**Illustration credit**:
A billable event recorded for every character-image generation request, regardless of whether the writer approves, discards, or regenerates the result.

**Active story**:
A story with at least one generation event in the current billing period. The unit behind the "concurrent stories" pricing dimension.
_Avoid_: concurrent story
