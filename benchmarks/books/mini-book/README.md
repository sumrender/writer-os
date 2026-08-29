# The Brass Compass — synthetic mini-book fixture

A tiny invented story whose correct benchmark outcomes are **known by
construction**: every fact the prose establishes is listed below, and the
assertion set encodes exactly those facts. Used to verify all benchmark
machinery offline — no LLM calls required. Not a published work.

## Prose grammar

Each non-blank line of every chapter is one canonical sentence from the same
grammar the rule-based fakes (`src/lib/fakes.ts`) parse:

| Sentence template | Fact established |
|---|---|
| `Introducing <Name>, <tagline>.` | character `<Name>` |
| `<A> is known for <attribute>: <contains>.` | appearance |
| `<A> is the <relation> of <B>.` | relationship `A →type→ B` |
| `The <item> rests with <holder>.` | item (holder replaces any prior holder) |
| `The scene is set in <place>.` | location `<place>` (append-when-new by name) |
| `The matter of <thread> stands open\|resolved\|dormant.` | thread (status replaces) |
| `In this world, <topic>.` | world rule |
| `It happened that <event>.` | in-world timeline event, ordered by reading order |
| `Say always "<term>", never otherwise.` | lexicon term, spelling locked |
| `Style decree — <field>: <value>.` | style guide field |

## Ground truth by chapter

- **ch1** — characters Mara Vey, Joren Vey; relationship *Mara is the daughter
  of Joren*; appearance *Mara / her coat / salt-white wool*; location *the
  northern light*; style *narration = close third person, past tense*;
  timeline event *the harbor bell rang*.
- **ch2** — item *brass compass* held by **Mara Vey**; thread *the missing
  ledger* **open**; lexicon term *Vess*, spelling locked.
- **ch3** — timeline event *the ledger burned* (after the bell); world rule
  *the northern light burns without oil*.
- **ch4** — compass holder changes to **Joren Vey**; ledger thread
  **resolved**; relationship *Joren is the father of Mara*.

`assertions.yml` mirrors this list, including four `must_not` probes: the
plausible kinship confusion (*sister*), an unestablished holder
(*Bellin the harbormaster*), a fabrication probe for a never-stated world
rule (*iron ships*), and the directional location confusion (*the southern
light*).
