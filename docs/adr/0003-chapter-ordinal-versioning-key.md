# Chapter ordinal is the versioning key

Canon-state queries like "as of chapter 40" need exactly one authoritative ordering. We use the chapter ordinal — a chapter's position in the story's manuscript order inside Writer OS — as the validity-range key on all canon facts. The in-world timeline remains a Story Bible entity used by generation and checking, but never serves as a versioning key, so flashbacks and parallel POV threads cannot corrupt current-state queries (PRD §5.2).

Changing this later would mean recomputing every fact's validity range, so it is treated as hard to reverse.
