# Product Requirements Document: Writer OS

**Status:** Draft
**Owner:** Product
**Team context:** Solo / 2–3 person team, limited budget
**Monetization:** Paid SaaS, usage-tiered subscription via Dodo Payments. No free trial — promotional access is handled via discount coupon codes instead.

---

## 1. Problem Statement & Target User Personas

### Problem

Writers who consume large volumes of serialized web fiction (Royal Road, ScribbleHub, webnovel platforms) increasingly want to write and publish their own stories. Producing a long-form serialized novel well requires two largely disjoint skill sets — narrative craft (plot, character, voice, pacing) and visual art (character/scene illustration) — and most writers are strong in only one.

Existing tools don't solve this jointly:
- **Generic AI writing tools** (chat-based LLM assistants, prose-generation plugins) have no durable memory of a story's established facts, character voices, or world rules. Past a few chapters, they drift, contradict earlier canon, or produce prose that doesn't sound like the writer's established voice.
- **AI image tools** can produce a striking one-off illustration, but have no mechanism to keep a specific character's face, build, and defining features consistent across dozens or hundreds of separate generations over months of serialization.

Both problems get worse — not linearly, but compoundingly — as a story grows toward the hundreds-of-chapters scale that serialized fiction lives at. A contradiction introduced in chapter 12 that isn't caught until chapter 140 is far more expensive to fix (in writer time, reader trust, and retcon complexity) than one caught immediately.

Writer OS's thesis: this is fundamentally a **structured data problem**, not a bigger-context-window problem. If a story's canon (characters, world, plot, style, glossary) is captured as structured, queryable data rather than buried in prose the writer has to remember or an LLM has to re-infer, both the prose generator and the image generator can reliably stay consistent with it — and drift can be automatically detected rather than caught by chance.

The product is **genre-agnostic by design** — it must work equally well for fantasy, sci-fi, contemporary, romance, or any other serialized fiction genre, not tuned toward one at the expense of others.

### Target Personas

**P1 — The Hobbyist Serializer**
Writes as a hobby, often already reads/writes on platforms like Royal Road or ScribbleHub. Has ideas and a decent ear for prose but no formal training. Wants help staying organized across a long story more than help writing sentences. Illustrations are a "nice to have" that makes chapters feel more professional and shareable. Price-sensitive; will churn if the tool doesn't clearly save time or improve output within the first few chapters.

**P2 — The Aspiring Serial Author (growth-oriented)**
Treats their web novel as a step toward an audience, and possibly income (Patreon, platform ad-share, eventual self-publishing). Cares a lot about consistency because they've seen (or experienced) reader backlash over canon contradictions and art that doesn't match established characters. Wants publishing metadata (synopsis, tags, content warnings) generated cleanly since they're managing multiple platforms. More willing to pay if the tool visibly protects/grows their audience.

**P3 — The Visual-first Writer**
Strong worldbuilder/character designer, weaker prose stylist. Wants the Story Architect and style guide machinery to help their prose sound more consistent and intentional, while leaning on the illustration pipeline to do what they'd otherwise pay a commissioned artist for, repeatedly, across a long serialization.

All three personas are the same core buyer for v1 — the differences show up in which features they lean on, not in different product surfaces.

---

## 2. Goals & Success Metrics

### Product-level goals

| Goal | Metric | Target signal (early) |
|---|---|---|
| Writers actually finish and publish chapters using the pipeline | Chapters published per active story per week | Median ≥1, matching typical serialization cadence |
| The Story Bible is genuinely load-bearing, not ignored | % of chapters generated with Story Bible context assembled (vs. bypassed) | >90% |
| Writers trust the consistency checker enough to use it | % of flagged issues reviewed (not dismissed unseen) | >70% |
| Illustration pipeline is usable at real story scale | Median cost & latency per on-model character image | Tracked from day one; must stay within COGS budget per subscription tier |
| Retention justifies subscription pricing | Month-2 retention of writers who published ≥3 chapters | Primary early health metric — no fixed target until baseline exists |
| Usage-tiered pricing is metering the right things | Per-writer/story cost-to-serve vs. tier price, broken out by chapters generated, illustration generations, and concurrent stories | Tracked from day one; informs tier boundary adjustments pre- and post-launch |

### Consistency quality — the core differentiator — needs its own metrics, split three ways:

**Factual consistency**
- Definition: no chapter contradicts a Story Bible fact (character state, plot thread status, item location, timeline) without either (a) being an intentional revision the writer approved, or (b) being flagged by the checker.
- Metric: contradiction escape rate — contradictions a reader would notice that ship without being flagged. Measured initially via manual spot-audits on a sample of generated chapters + writer-reported "the AI got this wrong" incidents.

**Stylistic consistency (voice/style drift)**
- Definition: generated prose stays within the bounds of the story's Writing Style Guide (POV, tense, register, dialogue/description balance) and doesn't drift from the style exemplars over time.
- Metric: this is the least mature area at launch (see Risks, §7) — plan to start with a coarse automated similarity check against style exemplars plus writer-reported drift, and treat true measurement as a later investment once real usage data exists.

**Visual consistency**
- Definition: a character's canonical identifying features (as captured in structured appearance fields) remain recognizable across independently generated images of that character.
- Metric: writer-facing "does this look like [character]?" approval rate at generation time, tracked per character over the life of the story, plus regeneration rate (how often a writer discards/retries an image) as a proxy for consistency failures.

### Non-goal for v1 metrics
We are explicitly **not** trying to optimize for prose "quality" in a general literary sense at launch — quality is subjective and hard to measure cheaply. The bet is that consistency at scale is the differentiated, measurable problem worth solving first.

---

## 3. Non-Goals / Explicit Scope Boundaries (v1)

- **No panel-by-panel comic/webtoon generation.** Writer OS generates standalone reference and scene illustrations, not sequential comic art.
- **No multi-language localization.** English-only for v1 (Story Bible, generation, UI).
- **No native mobile app.** Web-first, responsive-enough to be usable on mobile browsers, but no dedicated iOS/Android app.
- **No collaborative multi-writer editing within a single story** at launch (despite "collaborative" in the product description referring to the *human-AI* Story Architect conversation, not multi-human co-authoring). Multi-author stories are a plausible later feature, not v1.
- **No direct auto-publish integration** to third-party platforms (Royal Road, etc.) in v1 — writers export/copy chapters out.
- **No per-writer / per-character model fine-tuning** for illustration — v1 uses reference-image-conditioned generation against a shared base model, for cost and scalability reasons (see §6).
- **No existing-story import.** Every story is assumed to start fresh via the Story Architect; Writer OS does not retroactively build a Story Bible from chapters written elsewhere.
- **No free trial or freemium tier.** Access is subscription-only from day one; promotional/discounted access is handled through coupon codes, not a free tier.
- **No genre-specific tuning.** The product is built genre-agnostic from day one — no launch genre is prioritized over others in the Story Architect, generation pipelines, or checker logic.

---

## 4. User Journeys

### 4.1 Onboarding a new story via the Story Architect

1. Writer starts a new story project and enters the Story Architect — a guided, multi-turn conversation rather than a blank "describe your story" box.
2. Architect asks structured, sequenced questions: premise/logline → genre & tone → world basics → protagonist(s) → central conflict → supporting cast → story structure/arc shape.
3. At each stage, the Architect proposes structured Story Bible entries (a character card, a world rule, a plot thread) in an editable side panel as the conversation progresses — not just at the end. Writer can accept, edit inline, or reject/redirect the conversation.
4. Architect prompts specifically for style: asks the writer for 2–3 paragraphs of prose they consider representative of the voice they want (either pasted from elsewhere or generated live and refined), and captures POV/tense/register decisions explicitly rather than inferring them.
5. Session ends with a populated initial Story Bible and a generated synopsis/logline/genre tags draft for the writer to approve.
6. Writer can re-enter Architect mode later to extend the bible (new arc, new faction) without starting over.

### 4.2 Writing and publishing a chapter

1. Writer starts a new chapter, optionally giving a short intent ("Mira confronts her brother about the letter") or letting the system suggest the next beat from open plot threads.
2. Chapter Generation Pipeline assembles relevant context: active characters' current state, relevant locations, open plot threads touching this scene, applicable world rules, the style guide, and the glossary — not the entire Story Bible.
3. Draft is generated and shown to the writer for direct editing (this is a co-writing surface, not a one-shot black box — writer can regenerate a section, edit by hand, or nudge tone).
4. On save/finalize, the Consistency Checker runs automatically, producing a pass/fail-with-flags result before the writer can mark the chapter "ready to publish."
5. If clean, writer reviews proposed Story Bible updates (e.g., "Mira now knows about the letter" → plot thread status change) and approves/edits them; approving both updates the bible and marks the chapter published within Writer OS.
6. Writer copies/exports the finished chapter to their external publishing platform(s) (v1 has no auto-publish integration).

### 4.3 Generating a character illustration

1. From a character's Story Bible card, writer requests an illustration — either the canonical reference image (first time) or a scene/state variant (e.g., "in her travel cloak, injured"). Writer can specify or select the desired art style, since art style is a writer-facing choice, not a fixed house style.
2. If no canonical reference exists yet, the system generates one from the character's structured appearance fields, writer reviews/regenerates/adjusts fields, and approves it as canonical.
3. For subsequent images, the pipeline conditions generation on the canonical reference image plus the structured appearance fields plus any relevant appearance-state version (e.g., "post-injury" state) rather than generating from text description alone.
4. Writer approves, discards, or requests a regeneration. Approved images attach to the chapter/scene and to the character's version history if they represent a state change (new outfit, injury, aging) the writer confirms is now canonical going forward.

### 4.4 Handling a mid-story consistency or style-drift conflict

1. Consistency Checker flags an issue on a chapter — e.g., a factual contradiction ("this chapter says the sword was lost, but Story Bible has it in the protagonist's inventory"), or a style-drift flag ("this chapter's dialogue-to-description ratio deviates significantly from the style guide").
2. Writer is shown the specific flagged passage, the conflicting Story Bible fact (for factual flags) or the exemplar comparison (for style flags), and a proposed resolution.
3. Writer chooses: (a) accept the proposed Story Bible update (this chapter is correct, canon changes), (b) reject and edit the chapter to match existing canon, or (c) mark as an intentional retcon, which prompts the system to flag all *earlier* chapters that assumed the old fact for the writer's awareness (not automatic rewriting — see §7 on retroactive handling).
4. Resolution is logged against both the chapter and the affected Story Bible entities so the history of the conflict and its resolution is auditable later.

---

## 5. Functional Requirements by Component

### 5.1 Story Architect

- Multi-turn guided conversation with a defined stage sequence (premise → genre/tone → world → characters → conflict → structure), not a single open-ended prompt.
- Produces structured Story Bible entries incrementally during the conversation, editable in real time, not only as a final summary.
- Explicitly elicits and captures style guide fields (POV, tense, register, dialogue/description tendencies, grammar/house style) and requires at least the exemplar paragraphs before a story is considered "ready to draft chapters" (soft gate, not hard-blocking).
- Supports re-entry for extending an existing bible (new arc/faction/character) using the same guided pattern.
- Generates a draft synopsis/logline/genre tags/content warnings from the completed bible for writer approval.
- Genre-agnostic question flow — no branch of the Architect assumes or is tuned toward a specific genre.

### 5.2 Story Bible (structured data, source of truth for all generators)

General requirement across every entity type below: each entity is **structured data with defined fields**, not a free-text blob, so that both the chapter pipeline and the consistency checker can query and reason over it programmatically. Free-text notes fields are allowed as a supplement, never a substitute, for the fields that matter to consistency.

- **Characters:** structured appearance fields (not prose description), personality, voice/speech patterns, relationships (typed, e.g., sibling/rival/mentor), current state, and a **versioned state history** (so "what did this character know/have/look like as of chapter 40" is queryable).
- **Locations:** structured descriptive fields, relevant world-rule associations (e.g., a location governed by a specific magic system rule).
- **Plot threads:** status field (open/resolved/dormant), linked chapters where introduced/advanced/resolved.
- **World rules:** magic/tech/political systems as structured rule sets, referenceable by ID from chapters and the checker (so "does this chapter violate the established magic system" is answerable).
- **Factions/organizations:** goals, hierarchy, status, and support for independent arcs not strictly tied to the protagonist's POV.
- **Item/artifact tracker:** current holder, provenance/history log.
- **Timeline / in-world calendar:** separate from chapter publication order, to support flashbacks and parallel POV threads without corrupting "current" state queries.
- **Foreshadowing / Chekhov's-gun tracker:** planted/paid-off/abandoned status, linked to the chapters where planted and (if resolved) paid off.
- **Writing Style Guide:** POV rules (including per-character POV rotation if applicable), tense, prose register, dialogue-to-description tendencies, grammar/house style (Oxford comma, em-dash conventions, capitalization of invented terms, US/UK spelling), and 2–3 style exemplar paragraphs.
- **In-world glossary/lexicon:** invented terms and locked spellings, naming conventions per culture/race, forms of address/honorifics — queryable so the chapter pipeline and checker can both use it.
- **Themes & motifs:** recurring symbols/ideas, for intentional-echo tracking rather than pure consistency-checking (softer, writer-facing feature).
- **Pacing guide:** target chapter length, cliffhanger cadence, release rhythm — informs chapter generation defaults.
- **Content rating/tone boundaries:** violence/romance intensity ceiling, used both to guide generation and as a check.
- **Publishing metadata:** synopsis/logline, genre tags, content warnings — generated from the bible, editable by the writer.

### 5.3 Chapter Generation Pipeline

- Assembles **only the relevant** Story Bible context per chapter via structured lookups (which characters/locations/threads are actually active in this scene) plus hierarchical summaries (for longer-running arcs) plus retrieval (for anything not caught by the above) — not a "dump the whole bible into context" approach.
- Style guide and glossary are included on every chapter-generation call, regardless of scene content, since voice and terminology consistency apply universally.
- Supports writer intent input (a beat/prompt) and a "suggest next beat from open threads" fallback.
- Draft is directly editable by the writer post-generation (co-writing surface).
- On finalize, triggers the Consistency Checker automatically before allowing "published" status within the tool.

### 5.4 Consistency Checker

- Runs automatically on chapter finalize; flags three categories: **factual contradictions** (against Story Bible state), **voice/style drift** (against the style guide and exemplars), and **glossary/naming violations** (against locked terms/spellings).
- For each flag, surfaces the specific passage, the conflicting Story Bible fact or style expectation, and a proposed resolution.
- Proposes Story Bible updates from new-chapter content (e.g., new facts established, plot thread status changes, item movements) for writer approval — never silently auto-writes canon.
- Supports the three-way resolution flow from journey 4.4 (accept as new canon / reject and fix chapter / intentional retcon with downstream flagging).
- Logs resolutions against both the chapter and affected bible entities for auditability.

### 5.5 Character Illustration Pipeline

- Generates a canonical reference image per character from structured appearance fields; writer reviews and approves before it becomes canonical.
- Uses **reference-image-conditioned generation** (canonical image + structured appearance fields + relevant appearance-state version) for all subsequent images of that character, rather than per-character model fine-tuning.
- **Art style is writer-facing, not fixed.** No default house visual style — the writer selects or specifies the desired art style (per story, and overridable per character/image) as a generation setting, and reference-conditioning is applied consistently within whatever style the writer has chosen.
- Supports versioned appearance states (new outfit, injury, aging) so a scene image can correctly reflect the character's state *at that point in the story*, not just their current/latest appearance.
- Writer can approve, discard, or regenerate; approved state-changing images update the character's version history.
- Generated images attach to the relevant chapter/scene for use in publishing.

---

## 6. Key Technical/Architectural Constraints for Engineering

1. **Structured data as source of truth, not prose-in-context.** The Story Bible must be real structured data (typed fields, IDs, relationships) queryable by both the prose and image generators and by the consistency checker — this is the foundational architectural bet the whole product depends on. Treating it as "a big document we paste into prompts" would defeat the purpose and reproduce the exact problem competitors have.
2. **Context assembly is a retrieval/summarization problem, not a context-window problem.** Chapter generation needs a defined strategy — structured lookups for "what's active in this scene," hierarchical summaries for long-running arcs, and retrieval as a fallback — designed and built deliberately, not left to "put more stuff in the prompt until it fits."
3. **Reference-image-conditioned generation over per-user/per-character fine-tuning.** Given the solo/small-team, cost-constrained context, per-character fine-tuning is very likely untenable at scale (training cost and time per character, across potentially many characters per story and many stories). Reference-image conditioning against a shared base model is the required approach for v1 economics — flag this early since it constrains which image-generation providers/APIs are viable, and since the model needs to support arbitrary, writer-chosen art styles rather than one house style.
4. **Versioning is a first-class concern, not an afterthought**, for both character state (appearance/knowledge/possessions over time) and Story Bible facts generally (to support retcon handling and "what was true as of chapter N" queries). This has real data-modeling implications up front — retrofitting versioning later is expensive.
5. **Usage-metered billing via Dodo Payments.** Pricing is a usage-tiered subscription (confirmed, §8.1) — no flat single-tier option and no freemium. The billing integration needs to support metering against the pricing model's usage dimensions (chapters generated, illustration generations, concurrent stories). Prose and image generation costs need to be tracked per writer/story from day one to keep tier design and margins sane — this is an engineering requirement, not just a product afterthought. Coupon-code redemption (for promotional/discounted access in lieu of a free tier) also needs to be supported in the Dodo Payments integration from launch.
6. **Consistency checker is a review-and-flag system, not an auto-correct system.** It should never silently rewrite the Story Bible or a chapter; every proposed change requires writer approval. This is both a product-trust requirement and a simpler, cheaper engineering target than an autonomous correction system.

---

## 7. Risks

- **Image generation cost at scale.** Reference-conditioned generation still costs per call; a story with a large cast and frequent illustration requests could get expensive fast. Needs real cost modeling against usage-tiered subscription pricing before launch, and likely a per-tier image generation quota or metered overage.
- **Consistency checker manual-review burden.** If the checker over-flags (too many false positives), writers will start ignoring it, defeating its purpose; if it under-flags, it doesn't deliver on the core promise. Tuning this tradeoff will require real usage data — v1 should probably launch conservative (fewer, higher-confidence flags) and expand coverage once we can observe writer response rates.
- **Retroactive handling of contradictions in older chapters.** When a writer marks something an intentional retcon, how far does the system go? Flagging affected earlier chapters is v1-scope; actually helping rewrite/patch them is a much bigger feature with real UX and cost implications not yet scoped.
- **Style drift detection is the least mature area technically.** "Does this chapter's prose still sound like the style guide/exemplars" is a fuzzier, harder-to-automate judgment than factual contradiction-checking. v1 likely needs a coarser heuristic (and to lean on writer self-report) while a more rigorous approach is developed post-launch with real data.
- **Story Architect quality bar.** A guided conversation that produces a genuinely useful, non-generic Story Bible on the first pass is itself a nontrivial product surface to get right — a weak Architect experience could undermine trust in everything downstream that depends on bible quality.
- **Small-team execution risk.** Given a 2–3 person team, the full v1 scope (Architect + Story Bible + chapter pipeline + checker + illustration pipeline) is ambitious; sequencing and phasing of the build (what ships first vs. as a fast-follow) will likely need to be revisited once implementation estimates exist.
- **No free trial, subscription-only access.** Without a free tier or trial, the coupon-code path is the only low-friction on-ramp for a hesitant new writer — worth watching conversion rate closely, since a purely paid gate on an unproven product is a real acquisition risk for a small team without existing audience/distribution. Coupon-code discount depth and distribution (who gets one, how deep the discount, how it's marketed) is an execution detail still to be worked out operationally, even though the mechanism itself is decided.
- **No existing-story import.** Writers with an already-in-progress story (a very plausible segment of the target personas, especially P2) cannot bring their story into Writer OS without manually rebuilding their Story Bible from scratch — likely a real adoption friction point worth monitoring even though it's out of scope for v1.
- **Usage-tiered pricing complexity.** Tiering by multiple usage dimensions (chapters/month, illustration credits/month, concurrent stories) is more legible to build for margin protection than a flat tier, but is also more work to communicate clearly to a price-sensitive persona (P1) and more work to meter accurately from day one (see §6.5). Getting the tier boundaries and overage model wrong at launch risks either bleeding margin or confusing/alienating exactly the price-sensitive segment most likely to churn on friction.
- **Rights/ownership ambiguity at launch.** Deferred to legal (see §8.6) — this remains a live risk until resolved, since writers are paying specifically to publish and potentially monetize what they create here, and ambiguity on ownership at launch is a trust risk worth resolving before terms of service go out, not after.

---

## 8. Resolved Decisions Log

All six previously open questions have owner-confirmed decisions as of this update. Nothing remains open at the product-decision level; each entry below notes any execution-level follow-up still needed.

1. **Pricing tiers — Decided: usage-tiered subscription via Dodo Payments.** Metered on usage dimensions such as chapters generated/month, illustration credits/month, and concurrent stories (exact dimension weighting and tier boundaries TBD against real cost data — see engineering constraint §6.5 and risk §7).
2. **Free trial / freemium on-ramp — Decided: neither.** No free trial and no free tier. Promotional/discounted access is handled entirely through coupon codes redeemable at checkout. Coupon distribution strategy and discount depth are still an open execution detail (see §7).
3. **Launch genre focus — Decided: genre-agnostic from day one.** No genre is prioritized in the Story Architect, generation pipelines, or checker logic (already reflected throughout §1, §3, §5.1).
4. **Existing-story import — Decided: no import; every story starts fresh via the Story Architect.** Writers with in-progress stories elsewhere must rebuild their Story Bible manually through onboarding; this is a known adoption-friction risk (see §7), not a v1 feature gap to close.
5. **Illustration style/art direction — Decided: writer's choice, no house style.** Art style is a writer-facing generation setting, selectable per story and overridable per character/image (already reflected in §5.5 and engineering constraint §6.3).
6. **Ownership/rights of generated content — Decided (for now): deferred to legal.** Product is not specifying writer-ownership terms in this document; legal will define the commitments around AI-generated prose and image ownership. Flagging again here, as in v1: this must be settled **before launch messaging and terms of service go out**, since it directly affects a paying, publish-and-monetize user base (see §7).