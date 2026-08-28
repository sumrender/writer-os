#!/bin/sh
# Sequential live benchmark runs across both real books, one timestamped log
# per run under results/runs/ (gitignored), indexed in results/runs/index.txt.
# Extraction responses and judge verdicts cache by default (the CLI's
# --cache true); set BENCH_CACHE=false to force fresh API traffic for
# every call. The active cache state is ALWAYS logged below and into the
# index so cached-vs-fresh provenance of each report is unambiguous.
set -u
cd "$(dirname "$0")/.."   # benchmarks/

RUNS_DIR="results/runs"
CACHE="${BENCH_CACHE:-true}"
mkdir -p "$RUNS_DIR"

if [ "$CACHE" = "true" ]; then
  echo "CACHE is ENABLED — judge verdicts + extraction responses persist by input hash under results/cache/"
else
  echo "CACHE is DISABLED — every model call reaches the API fresh; nothing persists"
fi

run_one() {
  book="$1"; axis="$2"
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  log="$RUNS_DIR/${stamp}-${book}-${axis}.txt"
  echo "START $(date -u +%FT%TZ) book=${book} axis=${axis} cache=${CACHE} log=${log}" >> "$RUNS_DIR/index.txt"
  node dist/runner/cli.js run --book "$book" --axis "$axis" --judge live --cache "$CACHE" > "$log" 2>&1
  status=$?
  echo "END   $(date -u +%FT%TZ) book=${book} axis=${axis} exit=${status} log=${log}" >> "$RUNS_DIR/index.txt"
}

run_one tom-sawyer extraction
run_one gullivers-travels extraction
run_one tom-sawyer checker
run_one gullivers-travels checker
run_one tom-sawyer generation
run_one gullivers-travels generation

echo "CHAIN DONE $(date -u +%FT%TZ)" >> "$RUNS_DIR/index.txt"
