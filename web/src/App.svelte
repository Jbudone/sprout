<script lang="ts">
import CreateView from './CreateView.svelte';
import HowItWorksView from './HowItWorksView.svelte';
import { resetProgress } from './lib/api';
import MathView from './MathView.svelte';
import StatsView from './StatsView.svelte';
import TriviaReviewView from './TriviaReviewView.svelte';
import TriviaView from './TriviaView.svelte';

let tab = $state<'math' | 'trivia' | 'review' | 'create' | 'stats' | 'how'>(
  'trivia',
);
let confirmingReset = $state(false);
let confirmTimeout: ReturnType<typeof setTimeout> | undefined;
// Bumped on reset so {#key} below remounts both views, forcing a fresh fetch.
let generation = $state(0);

async function handleResetClick() {
  if (!confirmingReset) {
    confirmingReset = true;
    clearTimeout(confirmTimeout);
    // Generous window: this is a deliberate two-tap confirm, not a
    // hair-trigger — err toward giving enough time to actually tap twice.
    confirmTimeout = setTimeout(() => (confirmingReset = false), 10000);
    return;
  }
  clearTimeout(confirmTimeout);
  confirmingReset = false;
  await resetProgress();
  generation += 1;
}
</script>

<div class="min-h-svh bg-white pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] dark:bg-gray-900 dark:text-gray-100">
  <nav class="sticky top-0 z-10 flex items-center relative overflow-x-auto border-b border-gray-200 bg-white/90 pr-24 backdrop-blur dark:border-gray-700 dark:bg-gray-900/90">
    <button
      type="button"
      class="flex-1 whitespace-nowrap px-2 py-3 text-center text-sm font-medium sm:text-base"
      class:border-b-2={tab === 'math'}
      class:border-blue-600={tab === 'math'}
      class:text-blue-600={tab === 'math'}
      onclick={() => (tab = 'math')}
    >
      Math
    </button>
    <button
      type="button"
      class="flex-1 whitespace-nowrap px-2 py-3 text-center text-sm font-medium sm:text-base"
      class:border-b-2={tab === 'trivia'}
      class:border-blue-600={tab === 'trivia'}
      class:text-blue-600={tab === 'trivia'}
      onclick={() => (tab = 'trivia')}
    >
      Trivia
    </button>
    <button
      type="button"
      class="flex-1 whitespace-nowrap px-2 py-3 text-center text-sm font-medium sm:text-base"
      class:border-b-2={tab === 'review'}
      class:border-blue-600={tab === 'review'}
      class:text-blue-600={tab === 'review'}
      onclick={() => (tab = 'review')}
    >
      Review
    </button>
    <button
      type="button"
      class="flex-1 whitespace-nowrap px-2 py-3 text-center text-sm font-medium sm:text-base"
      class:border-b-2={tab === 'create'}
      class:border-blue-600={tab === 'create'}
      class:text-blue-600={tab === 'create'}
      onclick={() => (tab = 'create')}
    >
      Create
    </button>
    <button
      type="button"
      class="flex-1 whitespace-nowrap px-2 py-3 text-center text-sm font-medium sm:text-base"
      class:border-b-2={tab === 'stats'}
      class:border-blue-600={tab === 'stats'}
      class:text-blue-600={tab === 'stats'}
      onclick={() => (tab = 'stats')}
    >
      Stats
    </button>
    <button
      type="button"
      class="flex-1 whitespace-nowrap px-2 py-3 text-center text-sm font-medium sm:text-base"
      class:border-b-2={tab === 'how'}
      class:border-blue-600={tab === 'how'}
      class:text-blue-600={tab === 'how'}
      onclick={() => (tab = 'how')}
    >
      How it works
    </button>
    <button
      type="button"
      class="absolute right-2 text-xs text-gray-400 underline"
      class:text-red-600={confirmingReset}
      onclick={handleResetClick}
    >
      {confirmingReset ? 'Confirm reset?' : 'Reset progress'}
    </button>
  </nav>

  {#key generation}
    {#if tab === 'math'}
      <MathView />
    {:else if tab === 'review'}
      <TriviaReviewView />
    {:else if tab === 'create'}
      <CreateView />
    {:else if tab === 'stats'}
      <StatsView />
    {:else if tab === 'how'}
      <HowItWorksView />
    {:else}
      <TriviaView />
    {/if}
  {/key}
</div>
