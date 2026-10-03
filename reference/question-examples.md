# Reference question examples

Curated examples of the quality bar and topic breadth this platform should
aim for. `content-creation` reads this file (if present) and includes it as
guidance when generating new math problems and trivia cards — the model is
told not to copy these verbatim, just to calibrate against them.

There's no required format. Freeform is fine: paste a question you liked
(from this platform, a textbook, a competition, wherever), a question you
disliked and why, or just a note like "more geometry, less pure algebra" or
"trivia has been all famous-theorems lately, want more applied-math and
math-in-culture." Add and remove entries over time as your taste becomes
clearer — this file is a living reference, not a fixed spec.

## Example: what "interesting" looks like (math)

A problem that's genuinely interesting rather than a rote textbook exercise
usually has one of these properties: it admits more than one solution
approach, it connects two areas that don't obviously touch (e.g. a counting
argument that resolves into a closed-form algebraic identity), or the setup
looks intimidating but resolves cleanly once you find the right substitution
or invariant.

## Example: concision, before and after (trivia)

The single biggest quality problem so far has been verbose questions that
explain the thing before asking about it. This card was real:

> Which famous theorem states that no three positive integers $a$, $b$, and
> $c$ can satisfy the equation $a^n + b^n = c^n$ for any integer value of
> $n$ greater than 2?

It states the whole theorem and then asks its name, so a reader who's paying
attention has nothing left to work out. Rewritten to lead with the notation
and ask for the one piece that's actually missing:

    question: [
      { "text": "$a^n + b^n = c^n$", "style": "formula" },
      { "text": "Fermat's Last Theorem — no positive integer solutions when:", "style": "context" }
    ]
    correctAnswer: "n > 2"
    distractors: ["n > 1", "n > 3", "n > 5"]

Three options, not four: a fourth threshold would be filler nobody weighs.
The Wiles proof and the margin story go in `explanation`, where they're a
reward for answering rather than a wall of text before it.

The same instinct applies to general knowledge, even with no formula in
sight — "Which river is the longest in South America and holds the largest
discharge volume of any river in the world?" is two questions welded
together, and the second clause gives away the first.

Even a formula+context split can have one clause too many. This card's
context line was cut on review:

    question: [
      { "text": "$a^2 + b^2 = c^2$", "style": "formula" },
      { "text": "This fundamental relationship for right triangles, where c is the hypotenuse, is known as:", "style": "context" }
    ]

When the formula is iconic enough to stand alone, drop the context segment —
the answer choices ("Pythagorean Theorem" vs. "Law of Cosines") already tell
the reader what's being asked. The same split (short lead segment + smaller,
less prominent secondary segment, or nothing at all) applies to biographical
trivia too, not just formulas — don't let backstory bleed into the question
stem.

**This specific rule keeps getting missed** — two separate "identify the
constant" formula cards added a context segment and got told the formula
alone was enough: $e^{i\pi}+1=0$ asking whose identity it is ("no need for
wording, the equation is enough context"), and $\phi \approx 1.618$ asking
its name ("text is unnecessary, the formula itself is enough context"). In
both cases the distractor list already disambiguated (numeric constants that
don't look alike), so the context segment was pure redundancy even though it
added true, non-repeated information. Default assumption for any
"identify-the-constant/formula" trivia card: **no context segment at all**.
Only add one if the bare formula is genuinely ambiguous against its specific
distractor set — not just because the constant might not be universally
recognized.

## Example: every clause in the stem has to discriminate

A descriptor only earns its place in the question if it's untrue of the
distractors — otherwise it's padding, not a clue. "Which self-taught,
**Indian** mathematician mailed unsolicited notebooks of original theorems
to G. H. Hardy?" wastes two clauses when the distractor pool (Mahalanobis,
Harish-Chandra, Bose) is *also* Indian — "Indian" and "self-taught" don't
narrow anything down. Same failure in "Which **small, nectar-feeding** bird
can fly backwards?" when the distractors (kingfisher, swift, sunbird) are
small and nectar/insect feeders too. Test each clause: if it would still be
true after swapping in a wrong answer, cut it from the question — it can go
in the explanation as flavor instead, where it's a reward rather than a
hurdle.

Superlatives get cut for the same reason, but for a sharper one: they give
away the answer's uniqueness before the reader has guessed. "What is the
only mammal capable of true, sustained flight?" answers its own question.
Ask the plain version — "Which mammal is capable of true, sustained
flight?" — and save "fun fact: it's the only one" for the explanation.

## Example: what a good trivia explanation looks like

Not just "X proved Y in year Z" — a sentence or two of *why* it mattered:
what problem it solved, what changed because of it, or what's surprising
about it. A trivia card is more fun when the explanation teaches something
beyond the bare fact the question asked about.

## Example: don't name a distractor inside the question stem

Flagged on review (round 3): "Which layer of Earth's interior sits directly
between the crust and the outer core?" with distractors The Crust, The Outer
Core, The Inner Core. Two of the three distractors are spelled out by name in
the stem itself, so a reader can eliminate them without knowing any geology —
the question is effectively multiple choice with one real option. Whenever a
stem locates something "between A and B" or otherwise names adjacent/related
items, don't also offer those named items as answer choices; pick distractors
that aren't already given away by the question's own wording.

## Example: single words can be padding too, not just clauses

Same instinct as "every clause has to discriminate" above, but it applies at
the word level too. "Which metallic element is liquid at **standard** room
temperature?" — every candidate is being asked about under the same
condition, so "standard" discriminates nothing and can just be cut: "Which
metallic element is liquid at room temperature?" loses no information.

## Example: don't chase obscurity for its own sake

A round-3 card asked who first used the √ symbol in print, answer Christoff
Rudolff, flagged simply as "too obscure." Attributing the origin of an
everyday, universally recognized symbol to a specific niche historical figure
turns the card into trivia-about-trivia rather than something a general
audience has a fighting chance at. If a notation/symbol-history question's
answer is a name most readers won't have encountered, either pick a more
widely-known notation/inventor pairing or reshape the question around what
the notation means rather than who first wrote it down.

That same category has a matching failure at the opposite extreme: a
round-11 card just showing "n!" and asking what it's called was flagged
"too easy." Between Rudolff's √ (too obscure a name) and n! (too obvious a
symbol), notation-and-symbols cards need a difficulty sweet spot: pick
notation that's genuinely recognizable-looking to an educated general
audience but not instantly nameable on sight — think ∑, ∫, ≈, ⊂, ∇, rather
than either a symbol everyone already learned the name of in school (n!, √,
π) or an obscure symbol's obscure inventor.

Obscurity isn't just about niche names — a round-5 card asked for the speed
of light "in meters per second" and wanted the exact defined value,
299,792,458, with distractors that were other precise-looking numbers nearby.
Flagged as "too obscure," because knowing light is ~300,000,000 m/s is common
knowledge but reciting the exact defined digit string is rote memorization,
not conceptual difficulty. Precision-of-recall is a cheap way to inflate a
question's elo rating without making it more interesting — if a fact's
"hard" version is just more decimal places or a longer number, that's a sign
to either ask about the concept instead (why is c exactly that value, what's
notable about it) or accept the rounded-and-more-recognizable version as the
answer.

## Example: what a well-calibrated card looks like

For contrast, a round-5 card — "What is the deepest known oceanic trench on
Earth?", answer Mariana Trench, distractors Kermadec/Philippine/Puerto Rico
Trench — got a flat "Great question!" on review. It's a single plain-prose
clause with nothing to cut, none of the distractors are named or implied in
the stem, and the fact is well-known enough to be gettable but specific
enough to be worth asking. That combination — one clean clause, distractors
that don't leak from the stem, and a fact sitting at "known but not obvious"
rather than either "everyone knows this" or "nobody could know this" — is
the target to calibrate every other card against.

Worth noting: a later card in the same style — "Which desert is the largest
hot desert in the world, covering a significant portion of North Africa?" —
names a region ("North Africa") that's true of the answer and false of every
distractor (Gobi, Arabian, Kalahari), so it looks superficially like the
crust/mantle mistake above but isn't one; it's a legitimate identifying
clue, not a named distractor. The rule is specifically "does this clause
name one of the other options," not "does this clause make the question
easier" — a clue that only narrows toward the true answer is fine even if
it's generous.

## Example: it's term familiarity, not "naming a category," that's the risk

Two round-6 cards were flagged "too easy": "Which of the following is one of
the three fundamental types of rock?" (answer: igneous) and "What property
of light causes a prism to separate white light into colors?" (answer:
dispersion). The original read on this was "asking the reader to name a
vocabulary term is inherently too easy" — but round-12 disproved that: "What
geological process involves one tectonic plate sliding beneath another into
the Earth's mantle?" (subduction) and "What mathematical technique optimizes
a linear objective function, subject to linear constraints?" (linear
programming) are the exact same *shape* — name the term for this process —
and both got "Great question!" The real variable is how universally known
the term already is, not the question's grammar: igneous/sedimentary/
metamorphic and light dispersion are things almost everyone covered in
grade school, while subduction and linear programming are known but more
specialized, so recalling the term still takes real knowledge. When judging
a "name this term" card, ask whether the term itself is genuinely
non-trivial for the target audience — not whether the question could
instead be phrased around a specific instance.

## Example: distractors shouldn't all fall to the same one-shot trick

Round-8 card: "Which mammal is capable of true, sustained flight?" (answer:
bat), distractors Flying Squirrel, Sugar Glider, Colugo. Flagged "slightly
too easy given the options... would be better to have other options that
make you unsure." The problem is that all three distractors are eliminated
by the exact same single fact — "these are gliders, not fliers" — so a
reader who knows that one distinction (not even bat-specific knowledge)
throws out all three at once and is left with the answer by elimination,
without knowing anything about bats. A good distractor set makes the reader
consider each option somewhat independently; if one fact wipes out the whole
field in one move, swap at least one distractor in for something that fails
for a different reason (e.g. a genuinely flighted-but-non-mammal animal, or
a mammal wrongly rumored to fly) so elimination can't be done in bulk.

## Example: it's nesting an example clause that's awkward, not fact count

Round-8's Yellowstone card packed location + feature + a named example into
one clause: "Which massive volcanic caldera in the western United States
features extensive geothermal activity, including famous geysers like Old
Faithful?" Flagged "good question but wording is awkward and slightly too
verbose." Initially read this as "too many facts in one sentence," but a
round-9 card disproved that: "Which mathematical constant, approximately
1.618, is widely observed in natural patterns, artistic compositions, and
architectural designs for its perceived aesthetic balance?" also carries
three facts in one sentence and got a flat "Great question!" The difference
is structure, not count — the golden-ratio card is a clean parallel list
("X, Y, and Z"), while the Yellowstone card nests a specific example inside
a descriptive clause ("features W, including famous Zs like Y") which reads
as a clause-within-a-clause. When a question needs several true,
discriminating facts, a flat parallel list is fine; avoid burying a named
example inside a relative clause describing something else.
