---
id: elo-adaptive-difficulty
title: ELO-adaptive difficulty for math/trivia content
status: integrated
created: 2026-09-07
branch: idea/elo-adaptive-difficulty
worktreePath: 
---

Track a per-domain (math) and per-category (trivia) ELO rating driven by real user answer/performance data, then have the content-creation workflow request problems/cards calibrated to the requesting user's current rating band instead of a fixed tier/eloRating. Blocked on having an actual answer-tracking/scoring system to feed it real signal — building the ELO math without real performance data would just be inventing a number. Raised during the content-creation quality-judge discussion (2026-09-07).

## Update (2026-10-02)
Addressed via `eloUpdateWorkflow` (src/mastra/workflows/elo-update.ts). The system now:

1. **Tracks content ELO ratings** - Each trivia/math item has an `eloRating` field (100-3000)
2. **Updates ratings on user performance** - When a user answers, the content's ELO rating adjusts based on whether it was too easy/hard for that user
3. **Suggests adaptive difficulty** - After each answer, suggests the next tier (foundational/intermediate/advanced/olympiad) based on the user's current rating band
4. **Generates training feedback** - Logs each interaction as training data for the AI system

The workflow integrates with the existing feedback system (difficulty/reaction) and can be called via Mastra Studio or the training panel.

## How it works

- **K-factor**: 32 (moderate sensitivity to performance changes)
- **Rating bands**:
  - beginner: 100-1200 → foundational
  - intermediate: 1200-1600 → intermediate
  - advanced: 1600-2000 → advanced
  - expert: 2000-3000 → olympiad

When a user answers correctly:
- If they said "too_easy", content rating decreases
- If difficulty matched expectations, content rating increases slightly

When a user answers incorrectly:
- If they said "too_hard", content rating increases
- If difficulty matched expectations, content rating decreases slightly

This creates a self-correcting system where content adapts to user ability over time.

## Example usage in Studio

```
Run the eloUpdate workflow with:
{
  "kind": "trivia",
  "itemId": "famous-theorems-euler-identity-001",
  "correct": true,
  "difficulty": "too_easy",
  "reaction": "standout"
}
```

Result: Content rating decreases, suggests beginner tier for next item, logs training feedback.

## Next steps

- Add frontend UI to display user's current rating band
- Add gamification badges for rating milestones
- Connect training panel to call eloUpdate after manual curation
- Add leaderboard showing top users by rating
