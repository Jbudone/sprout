import katex from 'katex';

const MATH_SEGMENT_PATTERN = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Content items store LaTeX inline with $...$/$$...$$ delimiters mixed into
// plain prose (see verify-math.ts's delimiter-balance checks) — this renders
// each math segment with KaTeX and leaves the surrounding text as-is.
export function renderLatexText(text: string): string {
  let result = '';
  let lastIndex = 0;

  for (const match of text.matchAll(MATH_SEGMENT_PATTERN)) {
    result += escapeHtml(text.slice(lastIndex, match.index));
    const [full, displayMath, inlineMath] = match;
    try {
      result +=
        displayMath !== undefined
          ? katex.renderToString(displayMath, {
              displayMode: true,
              throwOnError: false,
            })
          : katex.renderToString(inlineMath, {
              displayMode: false,
              throwOnError: false,
            });
    } catch {
      result += escapeHtml(full);
    }
    lastIndex = match.index + full.length;
  }
  result += escapeHtml(text.slice(lastIndex));
  return result;
}
