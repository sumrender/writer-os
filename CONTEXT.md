# Writer OS

Domain language for Writer OS: a SaaS that helps serialized-fiction writers keep both their prose and their character illustrations consistent with a story's established canon by treating canon as structured, queryable data.

## Language

### Story & canon

**Story Bible**:
The structured source of truth for a story: characters, locations, plot threads, world rules, style guide, lexicon, and related entities. Queryable by generators and the checker; never a free-text blob where structure matters.
_Avoid_: lorebook, lore document, bible file

**Canon**:
The body of facts a story has established, as represented in the Story Bible at a given point in manuscript progress.
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
A story's internal chronology, kept as Story Bible data. Used by generation and checking; never used as the key for canon-state version lookups.

**Published (in Writer OS)**:
A chapter's status after passing the Consistency Checker with the writer's approval of proposed canon changes. Internal to Writer OS; distinct from exporting/copying to an external platform.

### Metering

**Chapter generated**:
A billable event recorded for every chapter-draft generation call, including section regenerations and tone nudges.

**Illustration credit**:
A billable event recorded for every character-image generation request, regardless of whether the writer approves, discards, or regenerates the result.

**Active story**:
A story with at least one generation event in the current billing period. The unit behind the "concurrent stories" pricing dimension.
_Avoid_: concurrent story
