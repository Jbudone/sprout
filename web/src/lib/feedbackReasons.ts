// What a flag can point at, and the quick reasons offered for each. Targets are
// stored as strings: 'question', 'explanation', 'hints' (all of them),
// 'hint:<n>' (1-based) and 'option:<text>'.
export type TargetKind =
  | 'question'
  | 'option'
  | 'hint'
  | 'hints'
  | 'explanation';

export function targetKind(target: string): TargetKind {
  if (target.startsWith('option:')) return 'option';
  if (target.startsWith('hint:')) return 'hint';
  return target as TargetKind;
}

export const optionTarget = (text: string) => `option:${text}`;
export const hintTarget = (n: number) => `hint:${n}`;

export function targetLabel(target: string): string {
  const kind = targetKind(target);
  if (kind === 'option') return `Option “${target.slice(7)}”`;
  if (kind === 'hint') return `Hint ${target.slice(5)}`;
  if (kind === 'hints') return 'All hints';
  return kind === 'explanation' ? 'Explanation' : 'Question';
}

export type Reason = { id: string; label: string; kinds: TargetKind[] };

export const REASONS: Reason[] = [
  {
    id: 'unclear',
    label: 'Unclear wording',
    kinds: ['question', 'explanation'],
  },
  { id: 'wordy', label: 'Too wordy', kinds: ['question', 'explanation'] },
  { id: 'ambiguous', label: 'More than one answer fits', kinds: ['question'] },
  {
    id: 'wrong',
    label: 'Factually wrong',
    kinds: ['question', 'option', 'hint', 'hints', 'explanation'],
  },
  {
    id: 'grammar',
    label: 'Poor grammar',
    kinds: ['question', 'hint', 'hints', 'explanation'],
  },
  { id: 'also_correct', label: 'Also correct', kinds: ['option'] },
  { id: 'too_obvious', label: 'Too obvious', kinds: ['option'] },
  { id: 'confusing', label: 'Confusing', kinds: ['option'] },
  { id: 'too_similar', label: 'Too similar to another', kinds: ['option'] },
  { id: 'gives_away', label: 'Gives it away', kinds: ['hint', 'hints'] },
  { id: 'unhelpful', label: "Didn't help", kinds: ['hint', 'hints'] },
  { id: 'too_vague', label: 'Too vague', kinds: ['hint', 'hints'] },
  {
    id: 'not_easier',
    label: 'Not easier than the last',
    kinds: ['hint', 'hints'],
  },
  { id: 'repeats', label: 'Repeats another hint', kinds: ['hint', 'hints'] },
];

/** Reasons that apply to at least one of the flagged targets. */
export function reasonsFor(targets: string[]): Reason[] {
  const kinds = new Set(targets.map(targetKind));
  return REASONS.filter((r) => r.kinds.some((k) => kinds.has(k)));
}
