import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getRepoRoot } from '../utils/repo-root';
import { listTriviaCards, listMathProblems } from '../quiz/content';

export const contentLibraryTool = createTool({
  id: 'content-library-tool',
  description:
    'Reports on the current state of the trivia and math content libraries: counts by category/domain, recent additions, and quality distribution. Also lists all existing IDs to avoid duplicates. Supports filtering by quality score.',
  inputSchema: z.object({
    action: z.enum(['stats', 'listAllIds', 'recent', 'byQuality']),
    kind: z.enum(['trivia', 'math']).optional().describe('Required for stats/recent/byQuality, optional for listAllIds.'),
    minScore: z.number().int().min(1).max(5).optional().describe('byQuality only: minimum quality score threshold.'),
    maxScore: z.number().int().min(1).max(5).optional().describe('byQuality only: maximum quality score threshold.'),
  }),
  outputSchema: z.object({
    action: z.enum(['stats', 'listAllIds', 'recent', 'byQuality']),
    message: z.string(),
    stats: z.record(z.string()).optional(),
    ids: z.array(z.string()).optional(),
    items: z.array(z.record(z.any())).optional(),
  }),
  execute: async ({ action, kind, minScore, maxScore }) => {
    try {
      if (action === 'listAllIds') {
        const [trivia, math] = await Promise.all([listTriviaCards(), listMathProblems()]);
        const allIds = [...trivia.map(c => c.id), ...math.map(p => p.id)];
        return {
          action,
          message: `Found ${allIds.length} total items across trivia and math.`,
          ids: allIds.sort(),
        };
      }

      if (!kind) throw new Error('kind is required for stats and recent actions.');

      if (action === 'stats') {
        const items = kind === 'trivia' ? await listTriviaCards() : await listMathProblems();

        const categoryCounts =
          kind === 'trivia'
            ? items.reduce((acc, c) => {
                acc[c.category] = (acc[c.category] || 0) + 1;
                return acc;
              }, {} as Record<string, number>)
            : items.reduce((acc, p) => {
                acc[p.domain] = (acc[p.domain] || 0) + 1;
                return acc;
              }, {} as Record<string, number>);

        const eloRange =
          kind === 'trivia'
            ? items.length > 0
              ? `${Math.min(...items.map(c => c.eloRating))}–${Math.max(...items.map(c => c.eloRating))}`
              : 'N/A'
            : 'N/A';

        const tierCounts =
          kind === 'math'
            ? items.reduce((acc, p) => {
                acc[p.tier] = (acc[p.tier] || 0) + 1;
                return acc;
              }, {} as Record<string, number>)
            : {};

        const weekRange =
          items.length > 0
            ? `${Math.min(...items.map(p => p.weekNumber))}–${Math.max(...items.map(p => p.weekNumber))}`
            : 'N/A';

        // Count by quality score if available
        const scoreCounts = kind === 'trivia'
          ? items.reduce((acc, c) => {
              const score = c.qualityScore ?? 0;
              acc[score] = (acc[score] || 0) + 1;
              return acc;
            }, {} as Record<number, number>)
          : items.reduce((acc, p) => {
              const score = p.qualityScore ?? 0;
              acc[score] = (acc[score] || 0) + 1;
              return acc;
            }, {} as Record<number, number>);

        return {
          action,
          kind,
          message: `Library stats for ${kind}: ${items.length} total items.`,
          stats: {
            total: String(items.length),
            categoryDomainBreakdown: Object.entries(categoryCounts)
              .map(([k, v]) => `${k}: ${v}`)
              .join(', '),
            ...(kind === 'math'
              ? { tierBreakdown: Object.entries(tierCounts).map(([k, v]) => `${k}: ${v}`).join(', ') }
              : {}),
            weekRange,
            ...(kind === 'trivia' ? { eloRange } : {}),
            ...(Object.keys(scoreCounts).length > 0
              ? { qualityScoreDistribution: Object.entries(scoreCounts)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(', ') }
              : {}),
          },
        };
      }

      if (action === 'recent') {
        const items = kind === 'trivia' ? await listTriviaCards() : await listMathProblems();
        const recent = items
          .sort((a, b) => b.weekNumber - a.weekNumber || Number(b.id.split('-').pop()) - Number(a.id.split('-').pop()))
          .slice(0, 5);

        const recentList = recent.map(item => `${item.id} (week ${item.weekNumber})`).join('\n- ');

        return {
          action,
          kind,
          message: `Last 5 additions to ${kind}:`,
          stats: { recent: recentList },
        };
      }

      if (action === 'byQuality') {
        const items = kind === 'trivia' ? await listTriviaCards() : await listMathProblems();

        const filtered = items.filter(item => {
          const score = item.qualityScore ?? 0;
          if (minScore !== undefined && score < minScore) return false;
          if (maxScore !== undefined && score > maxScore) return false;
          return true;
        });

        // Sort by score descending, then by eloRating/week descending
        const sorted = filtered.sort((a, b) => {
          const aScore = a.qualityScore ?? 0;
          const bScore = b.qualityScore ?? 0;
          if (bScore !== aScore) return bScore - aScore;
          return kind === 'trivia'
            ? (b.eloRating ?? 0) - (a.eloRating ?? 0)
            : (b.weekNumber ?? 0) - (a.weekNumber ?? 0);
        });

        const itemsForDisplay = sorted.slice(0, 10).map(item => ({
          id: item.id,
          weekNumber: item.weekNumber,
          category: (item as any).category ?? item.domain,
          qualityScore: item.qualityScore ?? 'N/A',
          eloRating: (item as any).eloRating ?? null,
        }));

        return {
          action,
          kind,
          message: `Showing ${itemsForDisplay.length} item(s) with quality score ${minScore ?? 1}-${maxScore ?? 5}.`,
          items: itemsForDisplay,
        };
      }

      throw new Error(`Unknown action: ${action}`);
    } catch (error) {
      return {
        action,
        message: error instanceof Error ? error.message : String(error),
        success: false,
      };
    }
  },
});
