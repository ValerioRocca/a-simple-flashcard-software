// The Markdown Q&A document format.
//
//   # Optional title
//
//   ## Subtopic
//
//   **Q:** Question, may span
//   several lines.
//   **A:** Answer.
//   **Note:** Optional extra context.
//   **Reversed:** yes
//
// Markers and headings count only at the very start of a line. Inside a
// ``` code block nothing is a marker. `Q:` and `A:` also work without the bold.
// An HTML comment outside a card is ignored, and so is a card left entirely blank.

const RE_H1 = /^#(?:[ \t]+(.*))?$/;
const RE_H2 = /^##(?:[ \t]+(.*))?$/;
const RE_BOLD_MARKER = /^\*\*[ \t]*(q|a|note|reversed)[ \t]*(?::[ \t]*\*\*|\*\*[ \t]*:)[ \t]?(.*)$/i;
const RE_PLAIN_MARKER = /^(Q|A):(?:[ \t]+(.*))?$/;
const RE_SEPARATOR = /^[ \t]{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const RE_FENCE = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/;

const FIELD_OF = { q: 'question', a: 'answer', note: 'note', reversed: 'reversed' };

function matchMarker(line) {
  let m = RE_BOLD_MARKER.exec(line);
  if (m) return { type: FIELD_OF[m[1].toLowerCase()], rest: m[2] };
  m = RE_PLAIN_MARKER.exec(line);
  if (m) return { type: FIELD_OF[m[1].toLowerCase()], rest: m[2] || '' };
  return null;
}

function isStructural(line) {
  return RE_H1.test(line) || RE_H2.test(line) || matchMarker(line) !== null;
}

// A content line that would be read as structure is written with one leading
// space, which Markdown ignores; reading removes it again.
function escapeLine(line) {
  return isStructural(line) ? ` ${line}` : line;
}

function unescapeLine(line) {
  return line.startsWith(' ') && isStructural(line.slice(1)) ? line.slice(1) : line;
}

function fenceOpenedBy(line) {
  const m = RE_FENCE.exec(line);
  if (!m) return null;
  // A backtick fence cannot have backticks in its info string (that is inline code).
  if (m[1][0] === '`' && m[2].includes('`')) return null;
  return { char: m[1][0], length: m[1].length };
}

function closesFence(line, fence) {
  const m = RE_FENCE.exec(line);
  return Boolean(m) && m[1][0] === fence.char && m[1].length >= fence.length && m[2].trim() === '';
}

function cleanField(lines) {
  if (!lines) return null;
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start++;
  // A trailing --- is a separator between cards, not part of the text.
  while (end > start && (!lines[end - 1].trim() || RE_SEPARATOR.test(lines[end - 1]))) end--;
  return lines.slice(start, end).join('\n').trimEnd();
}

function parseReversed(value) {
  const v = value.trim().toLowerCase();
  if (['yes', 'y', 'true', '1'].includes(v)) return true;
  if (['no', 'n', 'false', '0', ''].includes(v)) return false;
  return null;
}

/**
 * Parse a Q&A document.
 * Returns `items` in document order: cards (`kind: 'card'`, with a `problems`
 * list that is empty when the card is valid) and stray text (`kind: 'problem'`).
 */
export function parseQA(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const items = [];
  let title = '';
  let subtopic = '';
  let entry = null;
  let field = null;
  let fence = null;
  let stray = null;
  let inComment = false;

  const closeStray = () => {
    if (stray) items.push(stray);
    stray = null;
  };

  const addStray = (lineNo, message, text) => {
    if (stray && stray.message === message) stray.text += `\n${text}`;
    else {
      closeStray();
      stray = { kind: 'problem', line: lineNo, message, text };
    }
  };

  const closeEntry = () => {
    if (!entry) return;
    const { fields, problems } = entry;
    const question = cleanField(fields.question);
    const answer = cleanField(fields.answer);
    const note = cleanField(fields.note);
    const blank = !question && !answer && !note && problems.length === 0 && !fence;
    if (blank) {
      // An untouched stub from the template.
      entry = null;
      field = null;
      return;
    }
    if (fields.question && !question) problems.push('Empty question');
    if (!fields.answer) problems.push('Question with no answer');
    else if (!answer) problems.push('Empty answer');
    if (fence) problems.push('Code block is not closed');
    items.push({
      kind: 'card',
      line: entry.line,
      subtopic: entry.subtopic,
      question: question ?? '',
      answer: answer ?? '',
      note: note ?? '',
      reversed: entry.reversed,
      problems,
    });
    entry = null;
    field = null;
    fence = null;
  };

  const startField = (name, rest) => {
    field = name;
    const first = rest.trimStart();
    entry.fields[name].push(first);
    fence = fenceOpenedBy(first);
  };

  lines.forEach((raw, index) => {
    const lineNo = index + 1;

    if (fence) {
      entry.fields[field].push(raw);
      if (closesFence(raw, fence)) fence = null;
      return;
    }
    if (inComment) {
      if (raw.includes('-->')) inComment = false;
      return;
    }

    let m;
    if ((m = RE_H2.exec(raw))) {
      closeStray();
      closeEntry();
      subtopic = (m[1] || '').trim();
      return;
    }
    if ((m = RE_H1.exec(raw))) {
      closeStray();
      closeEntry();
      subtopic = '';
      if (!title) title = (m[1] || '').trim();
      return;
    }

    const marker = matchMarker(raw);
    if (marker) {
      if (marker.type === 'question') {
        closeStray();
        closeEntry();
        entry = { line: lineNo, subtopic, reversed: false, problems: [], fields: { question: [] } };
        startField('question', marker.rest);
        return;
      }
      if (marker.type === 'answer') {
        closeStray();
        if (!entry) {
          entry = { line: lineNo, subtopic, reversed: false, problems: ['Answer without a question'], fields: {} };
        }
        if (entry.fields.answer) entry.problems.push('More than one **A:** in the same card');
        else entry.fields.answer = [];
        startField('answer', marker.rest);
        return;
      }
      if (!entry) {
        addStray(lineNo, 'This line is outside a card (a card starts with **Q:**)', raw);
        return;
      }
      closeStray();
      if (marker.type === 'note') {
        if (entry.fields.note) entry.problems.push('More than one **Note:** in the same card');
        else entry.fields.note = [];
        startField('note', marker.rest);
        return;
      }
      const reversed = parseReversed(marker.rest);
      if (reversed === null) entry.problems.push('**Reversed:** must be yes or no');
      else entry.reversed = reversed;
      field = null;
      return;
    }

    if (field) {
      const line = unescapeLine(raw);
      entry.fields[field].push(line);
      fence = fenceOpenedBy(line);
      return;
    }
    if (!raw.trim() || RE_SEPARATOR.test(raw)) {
      closeStray();
      return;
    }
    if (raw.trimStart().startsWith('<!--')) {
      closeStray();
      inComment = !raw.includes('-->');
      return;
    }
    addStray(lineNo, 'Text outside a card (a card starts with **Q:**)', raw);
  });

  closeStray();
  closeEntry();
  items.sort((a, b) => a.line - b.line);

  const cards = items.filter((item) => item.kind === 'card' && item.problems.length === 0);
  return { title, items, cards, problemCount: items.length - cards.length };
}

function fieldLines(marker, text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let fence = null;
  lines.forEach((line, index) => {
    if (fence) {
      out.push(line);
      if (closesFence(line, fence)) fence = null;
      return;
    }
    out.push(index === 0 ? line : escapeLine(line));
    fence = fenceOpenedBy(line);
  });
  // Leading whitespace on the first line would be lost after the marker.
  if (/^\s/.test(out[0])) return [marker, ...out];
  return [out[0] ? `${marker} ${out[0]}` : marker, ...out.slice(1)];
}

const oneLine = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

/** Entries without a subtopic first, then each subtopic in order of first appearance. */
export function orderBySubtopic(entries) {
  const groups = new Map([['', []]]);
  for (const entry of entries) {
    const key = oneLine(entry.subtopic);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  return [...groups.values()].flat();
}

/** Write entries (`{question, answer, note, reversed, subtopic}`) as a Q&A document. */
export function serializeQA(entries, { title = '' } = {}) {
  const out = [];
  if (oneLine(title)) out.push(`# ${oneLine(title)}`, '');
  let current = '';
  for (const entry of orderBySubtopic(entries)) {
    const sub = oneLine(entry.subtopic);
    if (sub !== current) {
      out.push(`## ${sub}`, '');
      current = sub;
    }
    out.push(...fieldLines('**Q:**', entry.question));
    out.push(...fieldLines('**A:**', entry.answer));
    if (entry.note) out.push(...fieldLines('**Note:**', entry.note));
    if (entry.reversed) out.push('**Reversed:** yes');
    out.push('');
  }
  return out.join('\n').replace(/\n*$/, '\n');
}

export const TEMPLATE = `<!--
How to fill this in (this note is ignored on import):

  **Q:** starts a question and **A:** its answer. Both can span several lines.
  A line starting with ## groups the cards below it under a subtopic.
  Add the line  **Reversed:** yes  to a card to also get its answer-to-question twin.
  Formulas go between dollar signs, e.g. $x^2$.
  Cards left blank are skipped.
-->

**Q:** 
**A:** 

**Q:** 
**A:** 

**Q:** 
**A:** 

**Q:** 
**A:** 

**Q:** 
**A:** 
`;
