import { describe, expect, it } from "vitest";
import type { AgnesClient } from "./agnes-client.js";
import { createAgnesGenerate } from "./agnes-generate.js";

describe("createAgnesGenerate", () => {
  it("conditions on assembled context, weaves beats into the prompt, and numbers the chapter N+1", async () => {
    const requests: Array<{ system: unknown; user: string }> = [];
    const client: AgnesClient = {
      model: "scripted",
      async complete(request) {
        requests.push({
          system: request.system,
          user: request.user,
        });
        return {
          choices: [{ message: { content: "The compass hummed. (prose continues)" } }],
        };
      },
    };

    const generated = await createAgnesGenerate(client)(
      {
        throughOrdinal: 10,
        assembledContext: 'canon fact line\nanother fact line',
        bibleStateAsOf: {
          characters: [],
          appearances: [],
          relationships: [],
          items: [],
          threads: [],
          worldRules: [],
          timeline: [],
          lexicon: [],
          style: [],
        },
      },
      { beats: ["Tom and Huck swear the blood oath"] },
    );

    expect(generated.ordinal).toBe(11);
    expect(generated.text).toContain("(prose continues)");

    expect(requests).toHaveLength(1);
    const sent = requests[0];
    if (sent === undefined) throw new Error("no request captured");
    expect(sent.user).toContain("Write chapter 11");
    expect(sent.user).toContain("canon fact line");
    expect(sent.user).toContain("- Tom and Huck swear the blood oath");
  });

  it("omits the beat block when no intent was supplied", async () => {
    let capturedUser = "";
    const client: AgnesClient = {
      model: "scripted",
      async complete(request) {
        capturedUser = request.user;
        return { choices: [{ message: { content: "prose" } }] };
      },
    };
    await createAgnesGenerate(client)({
      throughOrdinal: 1,
      assembledContext: "(facts)",
      bibleStateAsOf: {
        characters: [],
        appearances: [],
        relationships: [],
        items: [],
        threads: [],
        worldRules: [],
        timeline: [],
        lexicon: [],
        style: [],
      },
    });
    expect(capturedUser).toContain("No specific beats were requested");
  });
});
