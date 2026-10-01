// Card text → HTML: Markdown plus formulas.
//
// Formulas are taken out before Markdown sees them, because LaTeX is full of
// characters Markdown would rewrite (`_`, `*`, `\`). Each one becomes an empty
// placeholder element carrying the LaTeX source; the page fills it in with
// KaTeX after the HTML has been sanitised (see ui/render.js).
//
// Accepted delimiters:
//   inline   $x$   \(x\)   [$]x[/$]
//   display  $$x$$   \[x\]   [$$]x[/$$]   and [$]x[/$] alone on its line

import { Marked } from '../../vendor/marked/marked.esm.js';

const escapeAttr = (text) => text
  .replace(/&/g, '&amp;')
  .replace(/"/g, '&quot;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const PAIRS = [
  { open: '[$$]', close: '[/$$]', display: true },
  { open: '[$]', close: '[/$]', display: false },
  { open: '\\[', close: '\\]', display: true },
  { open: '\\(', close: '\\)', display: false },
  { open: '$$', close: '$$', display: true },
];

// `$x$`: the opening dollar is followed by a non-space, the closing one is
// preceded by a non-space and not followed by a digit, so "$5 and $10" is text.
const RE_SINGLE_DOLLAR = /^\$(?![\s$])((?:\\[^\n]|[^\\$\n])+?)(?<!\s)\$(?!\d)/;
const RE_INLINE_START = /\[\$\$?\]|\\\[|\\\(|\$/;
const RE_BLANK_LINE = /\n[ \t]*\n/;

function inlineMath(src) {
  for (const pair of PAIRS) {
    if (!src.startsWith(pair.open)) continue;
    const end = src.indexOf(pair.close, pair.open.length);
    if (end === -1) return null;
    const tex = src.slice(pair.open.length, end);
    if (!tex.trim() || RE_BLANK_LINE.test(tex)) return null;
    return { raw: src.slice(0, end + pair.close.length), tex: tex.trim(), display: pair.display };
  }
  const m = RE_SINGLE_DOLLAR.exec(src);
  return m ? { raw: m[0], tex: m[1], display: false } : null;
}

// A formula that fills its own line(s) is a display formula.
const BLOCK_RULES = [
  /^ {0,3}\$\$((?:(?!\$\$)[\s\S])+?)\$\$[ \t]*(?:\n+|$)/,
  /^ {0,3}\\\[((?:(?!\\\])[\s\S])+?)\\\][ \t]*(?:\n+|$)/,
  /^ {0,3}\[\$\$\]((?:(?!\[\/\$\$\])[\s\S])+?)\[\/\$\$\][ \t]*(?:\n+|$)/,
  /^ {0,3}\[\$\]((?:(?!\[\/\$\])[\s\S])+?)\[\/\$\][ \t]*(?:\n+|$)/,
];
const RE_BLOCK_CANDIDATE = /\n {0,3}(?:\$\$|\\\[|\[\$\$?\])/g;

function blockMath(src) {
  for (const rule of BLOCK_RULES) {
    const m = rule.exec(src);
    if (m && m[1].trim() && !RE_BLANK_LINE.test(m[1])) return { raw: m[0], tex: m[1].trim() };
  }
  return null;
}

const mathExtension = {
  extensions: [
    {
      name: 'mathBlock',
      level: 'block',
      // Lets a display formula end the paragraph above it without a blank line.
      start(src) {
        RE_BLOCK_CANDIDATE.lastIndex = 0;
        let m;
        while ((m = RE_BLOCK_CANDIDATE.exec(src))) {
          if (blockMath(src.slice(m.index + 1))) return m.index;
        }
        return undefined;
      },
      tokenizer(src) {
        const found = blockMath(src);
        return found ? { type: 'mathBlock', raw: found.raw, tex: found.tex } : undefined;
      },
      renderer(token) {
        return `<div class="math-tex" data-display="1" data-tex="${escapeAttr(token.tex)}"></div>\n`;
      },
    },
    {
      name: 'mathInline',
      level: 'inline',
      start(src) {
        const index = src.search(RE_INLINE_START);
        return index === -1 ? undefined : index;
      },
      tokenizer(src) {
        const found = inlineMath(src);
        return found
          ? { type: 'mathInline', raw: found.raw, tex: found.tex, display: found.display }
          : undefined;
      },
      renderer(token) {
        return `<span class="math-tex" data-display="${token.display ? 1 : 0}" data-tex="${escapeAttr(token.tex)}"></span>`;
      },
    },
  ],
};

// A single line break in the text is a line break on the card.
const marked = new Marked({ gfm: true, breaks: true });
marked.use(mathExtension);

/** Markdown to HTML. The result is NOT safe to insert as is: sanitise it first. */
export function markdownToHtml(src) {
  return marked.parse(String(src ?? ''), { async: false });
}

/** One-line plain text of a card side, for lists and tables. */
export function toPlainText(src, max = 200) {
  const text = String(src ?? '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, alt) => (alt ? `[${alt}]` : '[image]'))
    .replace(/<img\b[^>]*>/gi, '[image]')
    .replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, '$1')
    .replace(/\[\/?\$\$?\]/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^[ \t]{0,3}(?:#{1,6}|>|[-*+]|\d+\.)[ \t]+/gm, '')
    .replace(/\*\*|__|`/g, '')
    // *emphasis* and _emphasis_, but not a_b or 2 * 3
    .replace(/\*(?=\S)([^*\n]+?)(?<=\S)\*/g, '$1')
    .replace(/(?<![\w\\])_(?=\S)([^_\n]+?)(?<=\S)_(?!\w)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
