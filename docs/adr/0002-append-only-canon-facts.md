# Append-only canon facts with a derived present

The PRD's foundational bet (§6.1, §6.4) makes "what was true as of chapter N" a primary query, and retcon handling (§4.4) requires re-opening history without destroying it. We therefore model every Story Bible entity's state as append-only fact records, each carrying a validity range, with the entity's current state derived as a view rather than stored as mutable rows. The rejected alternative — mutable current-state rows plus a parallel audit/history table — was turned down because the audit trail can silently drift from live state and because retcons become range re-openings instead of edits to two places at once.

This costs more upfront data modeling, which the PRD explicitly calls cheaper than retrofitting versioning later (§6.4).
