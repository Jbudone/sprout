<script lang="ts">
import { renderLatexText } from './latex';

let { text, class: className = '' }: { text: string; class?: string } =
  $props();
</script>

<span class={className}>{@html renderLatexText(text)}</span>
