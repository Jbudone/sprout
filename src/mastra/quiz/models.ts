// Models offered in the Create tab. IDs use Mastra's "provider/model" router
// format; OpenRouter models are "openrouter/<vendor>/<model>". Verify names
// with `node .claude/skills/mastra/scripts/provider-registry.mjs --provider
// openrouter` before adding one. The UI also accepts any custom model string.
export type ModelOption = { id: string; label: string; provider: 'google' | 'openrouter' };

export const MODEL_OPTIONS: ModelOption[] = [
  { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'google' },
  { id: 'google/gemini-3.5-flash', label: 'Gemini 3.5 Flash', provider: 'google' },
  { id: 'openrouter/anthropic/claude-sonnet-5.5', label: 'Claude Sonnet 5.5', provider: 'openrouter' },
  { id: 'openrouter/anthropic/claude-haiku-4.5', label: 'Claude Haiku 4.5', provider: 'openrouter' },
  { id: 'openrouter/openai/gpt-5.4-mini', label: 'GPT-5.4 mini', provider: 'openrouter' },
  { id: 'openrouter/deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash', provider: 'openrouter' },
  { id: 'openrouter/x-ai/grok-4.7', label: 'Grok 4.7', provider: 'openrouter' },
  { id: 'openrouter/z-ai/glm-5.3-flash', label: 'GLM 5.3 Flash', provider: 'openrouter' },
];

export const DEFAULT_GENERATOR = 'google/gemini-2.5-flash';
export const DEFAULT_REVIEWERS = ['google/gemini-3.5-flash'];

export function providerAvailable(provider: ModelOption['provider']): boolean {
  return provider === 'google' ? !!process.env.GOOGLE_GENERATIVE_AI_API_KEY : !!process.env.OPENROUTER_API_KEY;
}

// For a custom model string, infer the provider from its prefix.
export function providerOf(modelId: string): ModelOption['provider'] | 'other' {
  if (modelId.startsWith('openrouter/')) return 'openrouter';
  if (modelId.startsWith('google/')) return 'google';
  return 'other';
}
