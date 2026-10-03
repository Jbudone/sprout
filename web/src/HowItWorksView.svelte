<script lang="ts">
// Hand-written explainer. If you change a workflow in src/mastra/workflows/,
// update the matching flow below (see AGENTS.md).
type Kind = 'auto' | 'you' | 'planned';
type Step = { title: string; who: string; note: string; kind: Kind };
type Flow = {
  name: string;
  run: string;
  summary: string;
  steps: Step[];
  loop?: string;
};

const flows: Flow[] = [
  {
    name: 'Make new quiz content',
    run: 'Mastra Studio → Workflows → contentCreation (batch) or contentAuthor (one item)',
    summary:
      'AI writes questions, two checks filter them, and only passing items reach the quiz.',
    steps: [
      {
        title: 'Request',
        who: 'You, in Studio',
        note: 'Pick the week number (math file names), how many items, and optionally a topic or tier.',
        kind: 'you',
      },
      {
        title: 'Generate',
        who: 'mathCurator agent (contentAuthor agent for single items)',
        note: 'Writes one item, guided by reference/question-examples.md.',
        kind: 'auto',
      },
      {
        title: 'Mechanical check',
        who: 'verifyMath / verifyTrivia tools (plain code, no AI)',
        note: 'Balanced LaTeX, one clear answer, distinct hints, no duplicate options.',
        kind: 'auto',
      },
      {
        title: 'Quality judge',
        who: 'contentQuality agent',
        note: 'Is it fun, the right difficulty, and clear? Fails come back with reasons.',
        kind: 'auto',
      },
      {
        title: 'Save',
        who: 'Workflow step',
        note: 'Trivia cards are added to the deck for their category (content.db); math goes to content/math. Items that fail 3 times are dropped.',
        kind: 'auto',
      },
      {
        title: 'Pending queue',
        who: 'New Review tab section',
        note: 'Instead of saving straight away, items wait here for you to approve, edit or reject.',
        kind: 'planned',
      },
      {
        title: 'Your verdict',
        who: 'You, in this app',
        note: 'Approve or reject with a one-tap reason. Saved so we can see whether the AI judge agrees with you.',
        kind: 'planned',
      },
    ],
    loop: 'Steps 2–4 repeat up to 3 times per item. Judge feedback is passed back into the next attempt.',
  },
  {
    name: 'Play and give feedback',
    run: 'This app: Math, Trivia and Review tabs',
    summary:
      'You answer questions; your answers and reactions are stored locally.',
    steps: [
      {
        title: 'Quiz API',
        who: 'src/mastra/quiz/routes.ts',
        note: 'Serves trivia from decks (content.db) and math from content/math, with your progress attached.',
        kind: 'auto',
      },
      {
        title: 'You answer',
        who: 'You, in this app',
        note: 'Pick all decks (shuffled) or one domain or deck, then answer, skip, or flag a card as too easy, too hard, not fun, or a standout.',
        kind: 'you',
      },
      {
        title: 'Progress saved',
        who: 'quiz.db',
        note: 'Holds your answers and feedback, separate from the cards. "Reset progress" clears it and never touches content.',
        kind: 'auto',
      },
      {
        title: 'Update difficulty (ELO)',
        who: 'eloUpdate workflow',
        note: 'Adjusts an item’s rating and suggests the next tier. Today you run it by hand in Studio; the app does not call it yet.',
        kind: 'planned',
      },
    ],
  },
  {
    name: 'Build a feature with AI',
    run: 'Mastra Studio → Workflows → featureDev',
    summary:
      'AI plans and codes in a throwaway copy of the repo. Nothing merges without your OK.',
    steps: [
      {
        title: 'Plan',
        who: 'architect agent',
        note: 'Turns your request into a plan.',
        kind: 'auto',
      },
      {
        title: 'Sandbox',
        who: 'worktree tool',
        note: 'Creates a separate git worktree on an exp/<id> branch so main stays untouched.',
        kind: 'auto',
      },
      {
        title: 'Build',
        who: 'builder agent',
        note: 'Writes the code inside the sandbox.',
        kind: 'auto',
      },
      {
        title: 'Review',
        who: 'reviewer agent',
        note: 'Approves, or sends notes back to the builder.',
        kind: 'auto',
      },
      {
        title: 'Your approval',
        who: 'You, in Studio',
        note: 'The workflow pauses here. Resume it with approve or reject.',
        kind: 'you',
      },
      {
        title: 'Merge or keep',
        who: 'worktree tool',
        note: 'Approve merges and cleans up. Reject (or 3 failed reviews) leaves the sandbox for you to inspect.',
        kind: 'auto',
      },
    ],
    loop: 'Build and Review repeat up to 3 times until the reviewer approves.',
  },
  {
    name: 'Try out an idea',
    run: 'Mastra Studio → Workflows → ideaExperiment',
    summary:
      'Same sandbox idea, but you drive it by chatting instead of AI building alone.',
    steps: [
      {
        title: 'Load idea',
        who: 'ideas/<slug>.md',
        note: 'Reads one of your saved idea notes.',
        kind: 'auto',
      },
      {
        title: 'Sandbox',
        who: 'worktree tool',
        note: 'Creates an idea/<slug> branch in its own folder.',
        kind: 'auto',
      },
      {
        title: 'Experiment',
        who: 'You + experimenter agent',
        note: 'Chat with the agent in Studio, pointed at the sandbox. The workflow waits for you.',
        kind: 'you',
      },
      {
        title: 'Decide',
        who: 'You, in Studio',
        note: 'Resume with keep-experimenting, integrate (commit and merge), or abandon.',
        kind: 'you',
      },
    ],
  },
];

const kindStyle: Record<Kind, string> = {
  auto: 'border-gray-300 bg-gray-50 dark:border-gray-600 dark:bg-gray-800',
  you: 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950',
  planned:
    'border-dashed border-amber-500 bg-amber-50 dark:border-amber-400 dark:bg-amber-950',
};

const kindLabel: Record<Kind, string> = {
  auto: 'Automatic',
  you: 'You',
  planned: 'Planned, not built yet',
};

const glossary: [string, string][] = [
  [
    'Agent',
    'An AI model with instructions and tools. It makes judgement calls.',
  ],
  ['Tool', 'A plain function an agent (or workflow) can call. No AI inside.'],
  [
    'Workflow',
    'A fixed sequence of steps. Some steps call agents; some pause for you.',
  ],
  [
    'Studio',
    'Mastra’s own UI at localhost:4111 (npm run dev). Where you start workflows and chat with agents.',
  ],
  [
    'Worktree sandbox',
    'A second checkout of the repo on its own branch, so experiments never touch your main code.',
  ],
];
</script>

<main class="mx-auto max-w-2xl space-y-8 p-4">
  <header class="space-y-2">
    <h1 class="text-xl font-semibold">How it works</h1>
    <p class="text-sm text-gray-600 dark:text-gray-300">
      This app plays the quiz. Mastra Studio (<code>npm run dev</code>, then
      localhost:4111) is where you run the AI workflows that make content and code.
    </p>
    <ul class="flex flex-wrap gap-2 pt-1 text-xs">
      {#each Object.keys(kindStyle) as k (k)}
        <li class="rounded border px-2 py-1 {kindStyle[k as Kind]}">{kindLabel[k as Kind]}</li>
      {/each}
    </ul>
  </header>

  <section class="space-y-2" aria-labelledby="big-picture">
    <h2 id="big-picture" class="font-medium">The big picture</h2>
    <p class="text-sm text-gray-600 dark:text-gray-300">
      Studio workflows make cards → decks in <code>content.db</code> → this app serves them →
      your answers go to <code>quiz.db</code> → (later) ratings steer what gets made next.
    </p>
  </section>

  {#each flows as flow (flow.name)}
    <section class="space-y-3" aria-labelledby={flow.name}>
      <div>
        <h2 id={flow.name} class="font-medium">{flow.name}</h2>
        <p class="text-sm text-gray-600 dark:text-gray-300">{flow.summary}</p>
        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">Run it: {flow.run}</p>
      </div>

      <ol class="space-y-0">
        {#each flow.steps as step, i (step.title)}
          <li>
            <div class="rounded border p-3 {kindStyle[step.kind]}">
              <div class="flex items-baseline justify-between gap-2">
                <span class="font-medium">{i + 1}. {step.title}</span>
                <span class="text-xs text-gray-500 dark:text-gray-400">{step.who}</span>
              </div>
              <p class="mt-1 text-sm">{step.note}</p>
            </div>
            {#if i < flow.steps.length - 1}
              <div class="py-0.5 text-center text-gray-400" aria-hidden="true">↓</div>
            {/if}
          </li>
        {/each}
      </ol>

      {#if flow.loop}
        <p class="text-xs italic text-gray-500 dark:text-gray-400">↻ {flow.loop}</p>
      {/if}
    </section>
  {/each}

  <section class="space-y-2" aria-labelledby="glossary">
    <h2 id="glossary" class="font-medium">Terms</h2>
    <dl class="space-y-2 text-sm">
      {#each glossary as [term, def] (term)}
        <div>
          <dt class="inline font-medium">{term}:</dt>
          <dd class="inline text-gray-600 dark:text-gray-300">{def}</dd>
        </div>
      {/each}
    </dl>
  </section>
</main>
