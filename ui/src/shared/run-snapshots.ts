import type {
  BibleSnapshot,
  ExtractionSnapshot,
  StoryBible,
  StoryFacts,
} from "@writer-os/benchmark/events";

/**
 * One entry of the runs page's shared snapshot switcher (issue #14): the
 * facts and bible layers for a given "as of chapter N" point, paired by
 * ordinal. A side is null when that ordinal has no snapshot for it.
 */
export interface SnapshotOption {
  readonly key: string;
  readonly label: string;
  readonly facts: StoryFacts | null;
  readonly bible: StoryBible | null;
}

export interface SnapshotOptionInput {
  readonly snapshots: readonly ExtractionSnapshot[];
  readonly bibleSnapshots: readonly BibleSnapshot[];
  readonly liveFacts: StoryFacts | null;
  readonly liveBible: StoryBible | null;
  readonly lastChapterOrdinal: number | null;
}

/**
 * Builds the shared switcher options: fact snapshots zipped with bible
 * snapshots by afterOrdinal; when no snapshots exist yet (mid-run), a single
 * live option pairing the live facts with the latest bible.
 */
export function buildSnapshotOptions(input: SnapshotOptionInput): readonly SnapshotOption[] {
  const biblesByOrdinal = new Map<number, StoryBible>();
  for (const snapshot of input.bibleSnapshots) {
    biblesByOrdinal.set(snapshot.afterOrdinal, snapshot.bible);
  }

  const ordinals = new Set<number>([
    ...input.snapshots.map((s) => s.afterOrdinal),
    ...biblesByOrdinal.keys(),
  ]);

  const options: SnapshotOption[] = [...ordinals]
    .sort((a, b) => a - b)
    .map((ordinal) => ({
      key: `snap-${ordinal}`,
      label: `as of chapter ${ordinal}`,
      facts: input.snapshots.find((s) => s.afterOrdinal === ordinal)?.facts ?? null,
      bible: biblesByOrdinal.get(ordinal) ?? null,
    }));

  if (options.length === 0 && input.liveFacts !== null) {
    options.push({
      key: "live",
      label: input.lastChapterOrdinal !== null
        ? `live · after chapter ${input.lastChapterOrdinal}`
        : "live",
      facts: input.liveFacts,
      bible: input.liveBible,
    });
  }

  return options;
}
