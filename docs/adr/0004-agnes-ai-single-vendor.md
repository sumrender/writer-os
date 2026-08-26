# Agnes AI as sole model vendor, behind internal generator interfaces

Both AI pipelines run on a single vendor: `agnes-2.5-flash` (prose, via its OpenAI-compatible Chat Completions endpoint) and `agnes-image-2.1-flash` (illustration). Chosen by the owner for cost (both models currently free at promo; list prices are far below comparable vendors) and integration simplicity. Both calls sit behind internal `ProseGenerator` and `ImageGenerator` interfaces so the vendor can be swapped without touching pipeline logic — the mitigation for concentrating availability, pricing, and quality risk on one lesser-known provider.

## Consequences

- **Identity preservation unproven.** The image docs emphasize composition preservation in edits; cross-generation character identity is only exemplified in prompting guides. A paid validation spike (test cast × scenes/states, judged on recognizability) gates Phase 2 illustration work.
- **Structured output gap.** No documented JSON-schema response mode on the text model; all structured outputs (Story Bible entries, checker flags) must flow through forced tool calls.
- **Ephemeral output URLs.** Generated images land on Agnes's own storage with undocumented retention; images must be copied to Writer OS-owned storage at generation time.
- **Metering cost basis.** Promo pricing is currently $0; COGS tracking must record list prices, or tier math breaks when promos end.
