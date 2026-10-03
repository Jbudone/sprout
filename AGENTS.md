# AGENTS.md

## CRITICAL: Load `mastra` skill first

Load the `mastra` skill BEFORE any Mastra work. Never rely on cached knowledge — APIs change between versions.

## Rules

- Register all agents, tools, workflows, and scorers in `src/mastra/index.ts`
- Use the `dev` and `build` scripts from `package.json` instead of running `mastra dev` / `mastra build` directly
- When testing the quiz API routes (`/quiz/*`) or the `web/` frontend locally — via curl, browser automation, or otherwise — start the Mastra dev server with `QUIZ_DB_FILE=quiz.test.db` (or any test-only filename) so testing never writes into the user's real `quiz.db` progress/feedback data. Delete the test file when done.
- Trivia decks/cards live in `content.db` (override with `CONTENT_DB_FILE`), separate from `quiz.db` progress. First start seeds it from the legacy `content/trivia/*.json` files (kept as a backup). When testing anything that adds cards (e.g. `contentCreation`), also set `CONTENT_DB_FILE=content.test.db` and delete it afterward. Math problems are still JSON files in `content/math/`.
- When you add, remove, or change a workflow in `src/mastra/workflows/` (steps, agents used, human gates), update the matching flow in `web/src/HowItWorksView.svelte` so the in-app diagram stays accurate. Mark unbuilt features as `planned`.

## Content creation

Two paths to add trivia/math content:

1. **Full workflow (batch generation):** Use `contentCreationWorkflow` to generate a batch with mechanical + quality checks. Best for regular content addition.
2. **Manual curation (single items):** Use `contentAuthorWorkflow` for one-off items where you want to skip the batch pipeline or author directly in Studio.

### Quality bar

Content passes only if:
- **Mechanical checks** (via `verifyMathTool` / `verifyTriviaTool`): balanced LaTeX, deterministic answer, distinct hints, no duplicate distractors
- **Quality judge** (via `contentQualityAgent`): fun/interest, difficulty-fit, concision (trivia), clarity (math)

To improve quality, edit the prompts in `src/mastra/agents/math-curator.ts`, `src/mastra/agents/content-quality.ts`, and optionally add examples to `reference/question-examples.md`.

## Resources

- [Mastra Documentation](https://mastra.ai/llms.txt)
