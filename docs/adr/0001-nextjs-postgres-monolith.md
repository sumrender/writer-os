# Single Next.js app backed by Postgres

Writer OS is built as one deployable full-stack TypeScript application (Next.js App Router) with Postgres as the sole datastore, multi-tenant via row-level `writer_id` scoping. With a solo/2–3 person team on a limited budget, a monolith keeps one language, one deploy, and no service boundary maintenance; the product's complexity lives in domain modeling and pipeline orchestration, not request routing.

## Consequences

- Retrieval for context assembly uses pgvector inside the same Postgres instance rather than a separate vector database (confirmed 2026-08-26).
- Long-running generations run through a Postgres-backed job queue (`generation_jobs`) in the same database rather than an external queue service.
- Any future extraction of pipelines into workers should preserve the single Postgres as the integration point.
