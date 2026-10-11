import type { Difficulty, Feedback, Reaction } from './api';
import { reasonsFor } from './feedbackReasons';

// Flags, reasons and notes for the card on screen. Every change is saved right
// away through `save`, so there is no submit button to forget.
export class FeedbackState {
  targets = $state<string[]>([]);
  reasons = $state<string[]>([]);
  notes = $state('');
  difficulty = $state<Difficulty | null>(null);
  reaction = $state<Reaction | null>(null);
  #save: (feedback: Partial<Feedback>) => void;

  constructor(
    initial: Feedback | null,
    save: (feedback: Partial<Feedback>) => void,
  ) {
    this.#save = save;
    this.targets = initial?.targets ?? [];
    this.reasons = initial?.reasons ?? [];
    this.notes = initial?.notes ?? '';
    this.difficulty = initial?.difficulty ?? null;
    this.reaction = initial?.reaction ?? null;
  }

  has(target: string): boolean {
    return this.targets.includes(target);
  }

  toggle(target: string) {
    this.targets = this.has(target)
      ? this.targets.filter((t) => t !== target)
      : [...this.targets, target];
    // Drop reasons that no longer apply to anything still flagged.
    const valid = new Set(reasonsFor(this.targets).map((r) => r.id));
    this.reasons = this.reasons.filter((r) => valid.has(r));
    this.commit();
  }

  toggleReason(id: string) {
    this.reasons = this.reasons.includes(id)
      ? this.reasons.filter((r) => r !== id)
      : [...this.reasons, id];
    this.commit();
  }

  toggleDifficulty(value: Difficulty) {
    this.difficulty = this.difficulty === value ? null : value;
    this.commit();
  }

  toggleReaction(value: Reaction) {
    this.reaction = this.reaction === value ? null : value;
    this.commit();
  }

  commit() {
    this.#save({
      difficulty: this.difficulty,
      reaction: this.reaction,
      notes: this.notes.trim() || null,
      targets: $state.snapshot(this.targets),
      reasons: $state.snapshot(this.reasons),
    });
  }
}
