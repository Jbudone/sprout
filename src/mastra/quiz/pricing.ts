import { getObservedTokens } from './creation-db';

// Prices come from OpenRouter's public model list (USD per token), cached for
// an hour. Google models called directly use the same price as their
// OpenRouter listing, which is what the id matches. If the list can't be
// fetched or a model isn't in it, a deliberately pessimistic fallback is used
// so a spend cap errs on the side of stopping early.
export type Price = { prompt: number; completion: number };

const FALLBACK_PRICE: Price = { prompt: 5e-6, completion: 15e-6 };
const CACHE_MS = 60 * 60 * 1000;

let cache: { at: number; prices: Map<string, Price> } | null = null;

async function loadPrices(): Promise<Map<string, Price>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.prices;
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { data: { id: string; pricing?: { prompt?: string; completion?: string } }[] };
    const prices = new Map<string, Price>();
    for (const m of body.data) {
      const prompt = Number(m.pricing?.prompt);
      const completion = Number(m.pricing?.completion);
      if (Number.isFinite(prompt) && Number.isFinite(completion) && prompt >= 0 && completion >= 0) {
        prices.set(m.id, { prompt, completion });
      }
    }
    cache = { at: Date.now(), prices };
    return prices;
  } catch {
    // Keep serving stale prices if we have them; otherwise everything falls back.
    return cache?.prices ?? new Map();
  }
}

export async function priceFor(modelId: string): Promise<{ price: Price; known: boolean }> {
  const prices = await loadPrices();
  const hit = prices.get(modelId.replace(/^openrouter\//, ''));
  return hit ? { price: hit, known: true } : { price: FALLBACK_PRICE, known: false };
}

/** Cost of one call: the provider-reported cost when present, else tokens x listed price. */
export async function costFor(
  modelId: string,
  tokens: { input?: number; output?: number },
  reported?: number,
): Promise<{ cost: number; estimated: boolean }> {
  if (typeof reported === 'number' && Number.isFinite(reported)) return { cost: reported, estimated: false };
  const { price } = await priceFor(modelId);
  return { cost: (tokens.input ?? 0) * price.prompt + (tokens.output ?? 0) * price.completion, estimated: true };
}

const DEFAULT_TOKENS = {
  generator: { input: 5000, output: 2000 },
  reviewer: { input: 4300, output: 1200 },
};
// Reviewers and generators run once per attempt; most cards pass in one or two.
const TYPICAL_ATTEMPTS = 1.5;

export type Estimate = {
  worstCaseUsd: number;
  typicalUsd: number;
  unpricedModels: string[];
  worstCaseCalls: number;
};

export async function estimateRun(
  count: number,
  config: { generator: string; reviewers: string[]; maxAttempts: number },
): Promise<Estimate> {
  async function perCall(model: string, role: 'generator' | 'reviewer') {
    // Prefer what this model actually used in past runs over the defaults.
    const observed = await getObservedTokens(model, role);
    const tokens = observed ?? DEFAULT_TOKENS[role];
    const { price, known } = await priceFor(model);
    return { usd: tokens.input * price.prompt + tokens.output * price.completion, known };
  }

  const parts = [
    { model: config.generator, ...(await perCall(config.generator, 'generator')) },
    ...(await Promise.all(config.reviewers.map(async m => ({ model: m, ...(await perCall(m, 'reviewer')) })))),
  ];
  const perAttempt = parts.reduce((sum, p) => sum + p.usd, 0);
  return {
    worstCaseUsd: count * config.maxAttempts * perAttempt,
    typicalUsd: count * Math.min(config.maxAttempts, TYPICAL_ATTEMPTS) * perAttempt,
    unpricedModels: parts.filter(p => !p.known).map(p => p.model),
    worstCaseCalls: count * config.maxAttempts * parts.length,
  };
}
