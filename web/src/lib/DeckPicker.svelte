<script lang="ts">
import type { Deck } from './api';
import { ALL_DECKS, type DeckFilter, domainLabel } from './deckFilter';

let {
  decks,
  value,
  onChange,
}: { decks: Deck[]; value: DeckFilter; onChange: (v: DeckFilter) => void } =
  $props();

const domains = $derived([...new Set(decks.map((d) => d.domain))].sort());
</script>

<label class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
  Playing
  <select
    class="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800"
    {value}
    onchange={(e) => onChange(e.currentTarget.value)}
  >
    <option value={ALL_DECKS}>All decks (shuffled)</option>
    {#each domains as domain (domain)}
      <optgroup label={domainLabel(domain)}>
        <option value={`domain:${domain}`}>Everything in {domainLabel(domain)}</option>
        {#each decks.filter((d) => d.domain === domain) as deck (deck.id)}
          <option value={`deck:${deck.id}`}>{deck.name} ({deck.cardCount})</option>
        {/each}
      </optgroup>
    {/each}
  </select>
</label>
