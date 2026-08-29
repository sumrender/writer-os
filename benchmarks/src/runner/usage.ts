import { RUNS_PER_BOOK } from "../lib/metrics.js";

/**
 * The CLI help text. Kept in its own module so every command can print it on
 * usage errors without a dependency cycle through the engine dispatch.
 */
export const USAGE = `usage:
  bench validate --book <id> [--books-root <dir>]
  bench run --book <id> --axis <extraction|checker|generation>
            [--runs <n>] [--pipeline <live|fake>] [--judge <stub|live>]
            [--cache <true|false>] [--log-level <off|info|debug>]
            [--format <text|json|events>] [--gates <file>] [--books-root <dir>]
  bench list [--books-root <dir>]
  bench help

run defaults: ${RUNS_PER_BOOK} runs · live pipelines (AGNES_API_KEY required;
pass --pipeline fake for a fully offline run) · stub judge · text report · lenient gates · cache on · info logs
The judge and pipelines share one rate-limited Agnes client (free tier executes
~20 RPM; AGNES_MIN_INTERVAL_MS widens the spacing). --cache true (default)
persists judge verdicts and extraction responses by input hash under
results/cache/; --cache false forces every call to reach the API fresh.
--log-level controls progress lines on stderr (stdout stays pure for --format json):
info = phase + per-chapter + per-assertion progress; debug = + every API call,
cache hit/miss, and retry. Both off by default at --log-level off.
--format events (extraction axis only) streams one JSON event per line on
stdout — run.started, chapter.started/chapter.completed (with the Story Bible
snapshot per chapter), run.completed (report + final bible + snapshots), or
run.failed — while all human logs stay on stderr.`;
