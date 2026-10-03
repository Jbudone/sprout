export type MathProblem = {
  id: string;
  weekNumber: number;
  tier: string;
  domain: string;
  promptLatex: string;
  finalAnswer: string;
  hints: string[];
  stepByStepSolutionLatex: string[];
  sanityVerificationNotes: string;
};

// Mirrors QUESTION_SEGMENT_STYLES in src/mastra/schemas/quiz.ts. Renderers
// treat anything they don't recognize as 'prose', so a style added there
// doesn't break a frontend that hasn't caught up yet.
export type QuestionSegmentStyle = 'formula' | 'context' | 'prose';

export type QuestionSegment = {
  text: string;
  style: QuestionSegmentStyle;
};

export type TriviaCard = {
  id: string;
  category: string;
  eloRating: number;
  question: QuestionSegment[];
  correctAnswer: string;
  acceptableAlternatives: string[];
  distractors: string[];
  hints: string[];
  explanation: string;
  learnMoreArticle: string;
};

export type Difficulty = 'too_easy' | 'too_hard';
export type Reaction = 'not_fun' | 'standout';

export type Feedback = {
  difficulty: Difficulty | null;
  reaction: Reaction | null;
  notes: string | null;
};

export type QuizStatus = 'unanswered' | 'answered' | 'skipped';

export type DeckRef = { id: string; name: string; domain: string };

export type Deck = DeckRef & {
  description: string | null;
  createdAt: string;
  cardCount: number;
};

export type Reviewer = { model: string; passed: boolean; issues: string[] };

// Who wrote and checked a card; null for cards that predate tracking.
export type Provenance = {
  runId: string;
  generator: string;
  attempts: number;
  reviewers: Reviewer[];
  approvedAt: string;
};

export type QuizListItem<T> = {
  item: T;
  provenance: Provenance | null;
  // Set for trivia cards; math problems don't belong to a deck.
  deck: DeckRef | null;
  status: QuizStatus;
  chosenAnswer: string | null;
  correct: boolean | null;
  feedback: Feedback | null;
};

export type Kind = 'math' | 'trivia';

export type ContentLibraryStats = {
  total: string;
  categoryDomainBreakdown: string;
  tierBreakdown?: string;
  weekRange: string;
  eloRange?: string;
};

export type ContentLibraryResult = {
  action: 'stats' | 'listAllIds' | 'recent' | 'byQuality';
  message: string;
  stats?: ContentLibraryStats;
  ids?: string[];
  items?: Array<{
    id: string;
    weekNumber: number;
    category: string;
    qualityScore: string | number;
    eloRating?: number;
  }>;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/quiz${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    throw new Error(
      `Request to ${path} failed: ${res.status} ${await res.text()}`,
    );
  }
  return res.json();
}

export function listQuiz<T>(kind: Kind): Promise<{ items: QuizListItem<T>[] }> {
  return request(`/${kind}`);
}

export function listDecks(): Promise<{ decks: Deck[] }> {
  return request('/trivia/decks');
}

export function answerQuiz(
  kind: Kind,
  itemId: string,
  chosenAnswer?: string,
): Promise<{ success: boolean; correct: boolean | null }> {
  return request(`/${kind}/${encodeURIComponent(itemId)}/answer`, {
    method: 'POST',
    body: JSON.stringify({ chosenAnswer }),
  });
}

export function skipQuiz(
  kind: Kind,
  itemId: string,
): Promise<{ success: boolean }> {
  return request(`/${kind}/${encodeURIComponent(itemId)}/skip`, {
    method: 'POST',
  });
}

export function sendFeedback(
  kind: Kind,
  itemId: string,
  feedback: Partial<Feedback>,
): Promise<{ success: boolean }> {
  return request(`/${kind}/${encodeURIComponent(itemId)}/feedback`, {
    method: 'POST',
    body: JSON.stringify(feedback),
  });
}

export function resetProgress(kind?: Kind): Promise<{ success: boolean }> {
  return request('/reset', {
    method: 'POST',
    body: JSON.stringify({ kind }),
  });
}

export async function getContentLibraryStats(
  kind: Kind,
): Promise<ContentLibraryResult> {
  return request(`/library/stats/${kind}`, { method: 'GET' });
}

export async function getContentLibraryAllIds(): Promise<ContentLibraryResult> {
  return request('/library/all-ids', { method: 'GET' });
}

export async function getContentLibraryRecent(
  kind: Kind,
): Promise<ContentLibraryResult> {
  return request(`/library/recent/${kind}`, { method: 'GET' });
}

export async function getContentLibraryByQuality(
  kind: Kind,
  minScore?: number,
  maxScore?: number,
): Promise<ContentLibraryResult> {
  const params = new URLSearchParams();
  if (minScore !== undefined) params.append('minScore', minScore.toString());
  if (maxScore !== undefined) params.append('maxScore', maxScore.toString());
  return request(`/library/by-quality/${kind}?${params}`, { method: 'GET' });
}

// ---- Create tab ----

export type ModelOption = {
  id: string;
  label: string;
  provider: string;
  available: boolean;
};

export type RunConfig = {
  generator: string;
  reviewers: string[];
  reviewMode: 'all' | 'majority';
  maxAttempts: number;
};

export type Brief = {
  brief: string;
  exclude: string[];
  count: number;
  deckName: string;
  domain: string;
};

export type RunStatus = 'running' | 'done' | 'failed';
export type CardStatus = 'pending' | 'approved' | 'rejected' | 'auto_rejected';

export type Run = {
  id: string;
  brief: Brief;
  config: RunConfig;
  status: RunStatus;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
};

export type PendingCard = {
  id: string;
  runId: string;
  card: TriviaCard;
  status: CardStatus;
  rejectReason: string | null;
  attempts: number;
  reviewers: Reviewer[];
  issues: string[];
  createdAt: string;
};

export function listModels(): Promise<{
  models: ModelOption[];
  defaults: { generator: string; reviewers: string[] };
  openrouterConfigured: boolean;
}> {
  return request('/create/models');
}

export function startRun(
  brief: Brief,
  config: RunConfig,
): Promise<{ runId: string }> {
  return request('/create/runs', {
    method: 'POST',
    body: JSON.stringify({ brief, config }),
  });
}

export function listRuns(): Promise<{
  runs: (Run & { counts: Record<CardStatus, number> })[];
}> {
  return request('/create/runs');
}

export function getRun(
  runId: string,
): Promise<{ run: Run; cards: PendingCard[] }> {
  return request(`/create/runs/${encodeURIComponent(runId)}`);
}

export function approveCard(cardId: string): Promise<{ success: boolean }> {
  return request(`/create/cards/${encodeURIComponent(cardId)}/approve`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function rejectCard(
  cardId: string,
  reason?: string,
): Promise<{ success: boolean }> {
  return request(`/create/cards/${encodeURIComponent(cardId)}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function approveAll(runId: string): Promise<{ approved: number }> {
  return request(`/create/runs/${encodeURIComponent(runId)}/approve-all`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}
