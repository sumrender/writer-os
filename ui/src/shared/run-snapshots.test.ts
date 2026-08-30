import { describe, expect, it } from "vitest";
import type {
  BibleSnapshot,
  ExtractionSnapshot,
  StoryBible,
  StoryFacts,
} from "@writer-os/benchmark/events";
import { buildSnapshotOptions } from "./run-snapshots.js";

function factsOf(name: string): StoryFacts {
  return {
    characters: [{ name }],
    locations: [],
    appearances: [],
    relationships: [],
    items: [],
    threads: [],
    worldRules: [],
    timeline: [],
    lexicon: [],
    style: [],
  };
}

function bibleOf(overview: string): StoryBible {
  return {
    bookOverview: overview,
    world: { classification: "earth", description: "", rules: [] },
    characterProfiles: [],
    locations: [],
    threadRollups: [],
    groups: [],
    itemsOfSignificance: [],
    lexiconNotes: [],
    openLoops: [],
    styleRollup: [],
    worldTimeline: [],
    bookTimeline: [],
    chapterSummaries: [],
    graph: { nodes: [], edges: [] },
  };
}

function factsSnapshot(afterOrdinal: number): ExtractionSnapshot {
  return { afterOrdinal, facts: factsOf(`c${afterOrdinal}`) };
}

function bibleSnapshot(afterOrdinal: number): BibleSnapshot {
  return { afterOrdinal, bible: bibleOf(`b${afterOrdinal}`) };
}

describe("buildSnapshotOptions", () => {
  it("zips facts snapshots with bible snapshots by afterOrdinal", () => {
    const options = buildSnapshotOptions({
      snapshots: [factsSnapshot(1), factsSnapshot(2)],
      bibleSnapshots: [bibleSnapshot(1), bibleSnapshot(2)],
      liveFacts: null,
      liveBible: null,
      lastChapterOrdinal: null,
    });

    expect(options).toEqual([
      {
        key: "snap-1",
        label: "as of chapter 1",
        facts: factsOf("c1"),
        bible: bibleOf("b1"),
      },
      {
        key: "snap-2",
        label: "as of chapter 2",
        facts: factsOf("c2"),
        bible: bibleOf("b2"),
      },
    ]);
  });

  it("leaves the facts or bible side null when an ordinal lacks that counterpart", () => {
    const options = buildSnapshotOptions({
      snapshots: [factsSnapshot(1), factsSnapshot(2)],
      bibleSnapshots: [bibleSnapshot(2)],
      liveFacts: null,
      liveBible: null,
      lastChapterOrdinal: null,
    });

    expect(options).toEqual([
      { key: "snap-1", label: "as of chapter 1", facts: factsOf("c1"), bible: null },
      { key: "snap-2", label: "as of chapter 2", facts: factsOf("c2"), bible: bibleOf("b2") },
    ]);
  });

  it("falls back to a single live option pairing liveFacts with the latest bible", () => {
    const options = buildSnapshotOptions({
      snapshots: [],
      bibleSnapshots: [],
      liveFacts: factsOf("live"),
      liveBible: bibleOf("latest"),
      lastChapterOrdinal: 2,
    });

    expect(options).toEqual([
      {
        key: "live",
        label: "live · after chapter 2",
        facts: factsOf("live"),
        bible: bibleOf("latest"),
      },
    ]);
  });

  it("labels the live option without an ordinal when no chapter has completed", () => {
    const options = buildSnapshotOptions({
      snapshots: [],
      bibleSnapshots: [],
      liveFacts: factsOf("live"),
      liveBible: null,
      lastChapterOrdinal: null,
    });

    expect(options).toEqual([
      { key: "live", label: "live", facts: factsOf("live"), bible: null },
    ]);
  });

  it("returns no options when there is nothing to show", () => {
    const options = buildSnapshotOptions({
      snapshots: [],
      bibleSnapshots: [],
      liveFacts: null,
      liveBible: null,
      lastChapterOrdinal: null,
    });

    expect(options).toEqual([]);
  });
});
