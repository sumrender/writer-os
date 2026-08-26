# LLM judge grades equivalence only

Benchmark grading (docs/TESTING.md §6) uses an LLM judge for values that differ superficially but may be semantically equivalent ("half-brother" vs "brother"). The judge's contract is deliberately narrow: given two values plus a fixed rubric, it answers only whether they are equivalent. It never reads the fixture text and never rules on what the source establishes — ground truth lives exclusively in the human-authored assertion set.

The alternatives were both worse. A purely deterministic grader fails on any phrasing variance and would force assertions (and bibles) into brittle exact-match forms. An LLM judge with access to the source text could decide ground truth itself — at which point the benchmark measures the judge's reading comprehension instead of the pipeline under test, its hallucinated passes become indistinguishable from real ones, and no verdict traces back to a citable claim. Restricting the judge keeps every pass/fail anchored to a chapter-cited assertion a human approved.

This is treated as hard to reverse because metric trust depends on it: loosening the judge's role after baselines exist silently invalidates every previously recorded score.
