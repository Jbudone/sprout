---
id: topic-breadth-verifier
title: Topic-breadth verifier for the content library
status: integrated
created: 2026-09-07
branch: 
worktreePath: 
---

Add a batch-level check (not a per-item verifier) that looks at recent content/math and content/trivia history and steers generation away from an over-narrow window of domains/categories/tiers, so the library ends up with broad topic exposure over time rather than repeatedly hitting the same few areas. Different in shape from the per-item quality judge: it needs to read the existing content library across runs, not just judge the current batch. Raised during the content-creation quality-judge discussion (2026-09-07).

## Update (2026-09-08)
Addressed via generation-time steering instead of a post-hoc verifier: buildMathBatchStep/buildTriviaBatchStep now call pickLeastUsedDomain()/pickLeastUsedCategory() (src/mastra/quiz/content.ts) when the caller doesn't pin a domain/category, tallying the whole content library and picking under-represented topics before generation. Paired with a user-curated reference/question-examples.md that content-creation splices into the generate prompts for quality/breadth calibration. Steers instead of rejecting-and-retrying, and needs no extra LLM call.
