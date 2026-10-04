import { getCreationDb, getSettings, monthToDateSpend, type Settings } from './creation-db';

export type CallStats = {
  model: string;
  role: 'generator' | 'reviewer';
  calls: number;
  failedCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  // Share of this cost that was computed from tokens x list price rather than reported by the provider.
  estimatedShare: number;
  avgLatencyMs: number;
};

export type GeneratorStats = {
  model: string;
  runs: number;
  cards: number;
  passedReview: number;
  approved: number;
  rejected: number;
  // Whole-pipeline cost (generator + reviewers) of the runs this model generated for.
  costUsd: number;
  costPerApprovedUsd: number | null;
};

export type ReviewerStats = {
  model: string;
  reviews: number;
  passed: number;
  // Of cards you decided, how often the reviewer's verdict matched yours.
  decided: number;
  agreed: number;
  costUsd: number;
};

export type OpenRouterBalance = {
  totalCredits: number;
  totalUsage: number;
  remaining: number;
  usageMonthly: number | null;
};

export type StatsSummary = {
  settings: Settings;
  monthToDateUsd: number;
  allTimeUsd: number;
  calls: CallStats[];
  generators: GeneratorStats[];
  reviewers: ReviewerStats[];
  openrouter: OpenRouterBalance | null;
};

async function fetchOpenRouterBalance(): Promise<OpenRouterBalance | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  const headers = { Authorization: `Bearer ${key}` };
  try {
    const [credits, keyInfo] = await Promise.all([
      fetch('https://openrouter.ai/api/v1/credits', { headers, signal: AbortSignal.timeout(8000) }).then(r => r.json()),
      fetch('https://openrouter.ai/api/v1/key', { headers, signal: AbortSignal.timeout(8000) }).then(r => r.json()),
    ]);
    const totalCredits = Number(credits?.data?.total_credits);
    const totalUsage = Number(credits?.data?.total_usage);
    if (!Number.isFinite(totalCredits) || !Number.isFinite(totalUsage)) return null;
    const monthly = Number(keyInfo?.data?.usage_monthly);
    return {
      totalCredits,
      totalUsage,
      remaining: totalCredits - totalUsage,
      usageMonthly: Number.isFinite(monthly) ? monthly : null,
    };
  } catch {
    return null;
  }
}

export async function computeStats(): Promise<StatsSummary> {
  const client = await getCreationDb();

  const callRows = await client.execute(`
    SELECT model, role, COUNT(*) AS calls, SUM(CASE WHEN ok = 1 THEN 0 ELSE 1 END) AS failed,
           COALESCE(SUM(input_tokens), 0) AS inp, COALESCE(SUM(output_tokens), 0) AS outp,
           COALESCE(SUM(cost), 0) AS cost,
           COALESCE(SUM(CASE WHEN cost_estimated = 1 THEN cost ELSE 0 END), 0) AS est_cost,
           COALESCE(AVG(latency_ms), 0) AS lat
    FROM model_calls GROUP BY model, role ORDER BY cost DESC
  `);
  const calls: CallStats[] = callRows.rows.map(r => ({
    model: r.model as string,
    role: r.role as 'generator' | 'reviewer',
    calls: Number(r.calls),
    failedCalls: Number(r.failed),
    inputTokens: Number(r.inp),
    outputTokens: Number(r.outp),
    costUsd: Number(r.cost),
    estimatedShare: Number(r.cost) > 0 ? Number(r.est_cost) / Number(r.cost) : 0,
    avgLatencyMs: Math.round(Number(r.lat)),
  }));

  const allTime = await client.execute('SELECT COALESCE(SUM(cost), 0) AS total FROM model_calls');

  // Per-generator rollup: join each run's config to its cards and its total cost.
  const runs = await client.execute('SELECT id, config FROM gen_runs');
  const runCosts = await client.execute('SELECT run_id, COALESCE(SUM(cost), 0) AS cost FROM model_calls GROUP BY run_id');
  const costByRun = new Map(runCosts.rows.map(r => [r.run_id as string, Number(r.cost)]));
  const cards = await client.execute('SELECT run_id, status, reviewers FROM pending_cards');

  const generatorOfRun = new Map<string, string>();
  const gen = new Map<string, GeneratorStats>();
  for (const r of runs.rows) {
    const model = (JSON.parse(r.config as string) as { generator: string }).generator;
    generatorOfRun.set(r.id as string, model);
    const g = gen.get(model) ?? { model, runs: 0, cards: 0, passedReview: 0, approved: 0, rejected: 0, costUsd: 0, costPerApprovedUsd: null };
    g.runs += 1;
    g.costUsd += costByRun.get(r.id as string) ?? 0;
    gen.set(model, g);
  }

  const rev = new Map<string, ReviewerStats>();
  for (const c of cards.rows) {
    const status = c.status as string;
    const g = gen.get(generatorOfRun.get(c.run_id as string) ?? '');
    if (g) {
      g.cards += 1;
      if (status !== 'auto_rejected') g.passedReview += 1;
      if (status === 'approved') g.approved += 1;
      if (status === 'rejected') g.rejected += 1;
    }
    const humanDecided = status === 'approved' || status === 'rejected';
    for (const v of JSON.parse(c.reviewers as string) as { model: string; passed: boolean }[]) {
      const rs = rev.get(v.model) ?? { model: v.model, reviews: 0, passed: 0, decided: 0, agreed: 0, costUsd: 0 };
      rs.reviews += 1;
      if (v.passed) rs.passed += 1;
      if (humanDecided) {
        rs.decided += 1;
        if (v.passed === (status === 'approved')) rs.agreed += 1;
      }
      rev.set(v.model, rs);
    }
  }
  for (const c of calls) {
    if (c.role === 'reviewer') {
      const rs = rev.get(c.model);
      if (rs) rs.costUsd = c.costUsd;
    }
  }
  for (const g of gen.values()) g.costPerApprovedUsd = g.approved > 0 ? g.costUsd / g.approved : null;

  return {
    settings: await getSettings(),
    monthToDateUsd: await monthToDateSpend(),
    allTimeUsd: Number(allTime.rows[0].total),
    calls,
    generators: [...gen.values()].sort((a, b) => b.cards - a.cards),
    reviewers: [...rev.values()].sort((a, b) => b.reviews - a.reviews),
    openrouter: await fetchOpenRouterBalance(),
  };
}
