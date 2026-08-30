import { useEffect, useState } from "react";
import type { CharacterProfile, GraphData } from "@writer-os/benchmark/events";
import { orderCharacters, type CharacterCard } from "../shared/characters.js";

/**
 * The Characters section of the Story Bible (issue #15): one card per
 * character, most graph-important first with the auto-detected protagonist
 * marked, opening into a detail drawer carrying the full profile —
 * appearance, personality, defining traits, background, arc, first
 * appearance, chapters mentioned, and the prose-form relationship list.
 */

function LabeledField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h5 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">{label}</h5>
      {children}
    </div>
  );
}

function ProseField({ label, text }: { label: string; text: string }) {
  if (text === "") return null;
  return (
    <LabeledField label={label}>
      <p className="mt-1 text-sm text-zinc-300">{text}</p>
    </LabeledField>
  );
}

function CharacterDetail({
  card,
  onClose,
}: {
  card: CharacterCard;
  onClose: () => void;
}) {
  const { profile, protagonist } = card;
  // Escape closes the drawer.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/60"
      onClick={onClose}
      data-testid="characters-drawer"
    >
      <aside
        className="h-full w-full max-w-md overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-6"
        onClick={(event) => event.stopPropagation()}
        aria-label={`${profile.name} profile`}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-zinc-100">
              {profile.name}
              {protagonist && (
                <span className="ml-2 rounded-full bg-amber-900/60 px-2 py-0.5 align-middle text-xs text-amber-200">
                  protagonist
                </span>
              )}
            </h3>
            <p className="mt-1 text-xs text-zinc-500">
              first appearance ch. {profile.firstAppearanceOrdinal} · mentioned in{" "}
              {profile.mentionOrdinals.length} chapter{profile.mentionOrdinals.length === 1 ? "" : "s"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close profile"
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <ProseField label="Appearance" text={profile.appearance} />
          <ProseField label="Personality" text={profile.personality} />
          {profile.definingTraits.length > 0 && (
            <LabeledField label="Defining traits">
              <ul className="mt-1 flex flex-wrap gap-1">
                {profile.definingTraits.map((trait) => (
                  <li
                    key={trait}
                    className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300"
                  >
                    {trait}
                  </li>
                ))}
              </ul>
            </LabeledField>
          )}
          <ProseField label="Background" text={profile.background} />
          <ProseField label="Arc" text={profile.arc} />
          <LabeledField label="Chapters mentioned">
            <p className="mt-1 text-sm text-zinc-300">
              {profile.mentionOrdinals.length === 0
                ? "none yet"
                : profile.mentionOrdinals.map((ordinal) => `ch. ${ordinal}`).join(", ")}
            </p>
          </LabeledField>
          <LabeledField label="Relationships">
            {profile.relationships.length === 0 ? (
              <p className="mt-1 text-sm text-zinc-600">none yet</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {profile.relationships.map((relationship) => (
                  <li key={`${relationship.other}: ${relationship.summary}`} className="text-sm text-zinc-300">
                    <span className="font-medium text-zinc-100">{relationship.other}</span>:{" "}
                    {relationship.summary}
                  </li>
                ))}
              </ul>
            )}
          </LabeledField>
        </div>
      </aside>
    </div>
  );
}

export function Characters({
  profiles,
  graph,
}: {
  profiles: readonly CharacterProfile[];
  graph: GraphData;
}) {
  const cards = orderCharacters(profiles, graph);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const selectedCard = cards.find((card) => card.profile.name === selectedName);

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 sm:col-span-2">
      <h4 className="mb-2 flex items-center justify-between text-sm font-semibold text-zinc-200">
        Characters
        <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
          {profiles.length}
        </span>
      </h4>
      {cards.length === 0 ? (
        <p className="text-sm text-zinc-600">none yet</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <li key={card.profile.name}>
              <button
                type="button"
                onClick={() => setSelectedName(card.profile.name)}
                className="h-full w-full rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-left transition-colors hover:border-zinc-600"
                aria-label={`Open ${card.profile.name}'s profile`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-zinc-100">{card.profile.name}</span>
                  {card.protagonist && (
                    <span className="rounded-full bg-amber-900/60 px-2 py-0.5 text-xs text-amber-200">
                      protagonist
                    </span>
                  )}
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-zinc-400">
                  {card.profile.appearance || card.profile.personality || "no prose distilled yet"}
                </p>
                <p className="mt-2 text-xs text-zinc-500">
                  {card.profile.relationships.length} relationship
                  {card.profile.relationships.length === 1 ? "" : "s"} · ch.{" "}
                  {card.profile.mentionOrdinals.join(", ")}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
      {selectedCard !== undefined && (
        <CharacterDetail card={selectedCard} onClose={() => setSelectedName(null)} />
      )}
    </section>
  );
}
