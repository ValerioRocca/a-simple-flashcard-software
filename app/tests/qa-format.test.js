import { describe, test, assert } from './harness.js';
import { parseQA, serializeQA, TEMPLATE } from '../js/core/qa-format.js';

const pick = ({ question, answer, note, reversed, subtopic }) => ({ question, answer, note, reversed, subtopic });

describe('Q&A format: reading', () => {
  test('reads a document with subtopics, multi-line fields and notes', () => {
    const doc = [
      '## Fitting algorithm',
      '',
      '**Q:** What work does KNN do at fit time?',
      '**A:** Almost none — it stores the training set. No parameters are estimated, which is why it is',
      'called a lazy learner.',
      '',
      '**Q:** What is the time cost of `fit`?',
      '**A:** O(nd) to copy the data.',
      '**Note:** The asymmetry is the point.',
      '',
      '## Choice of k',
      '',
      '**Q:** What happens as k increases?',
      '**A:** The boundary gets smoother.',
      '',
    ].join('\n');
    const { cards, problemCount, title } = parseQA(doc);
    assert.equal(problemCount, 0);
    assert.equal(title, '');
    assert.deepEqual(cards.map(pick), [
      {
        question: 'What work does KNN do at fit time?',
        answer: 'Almost none — it stores the training set. No parameters are estimated, which is why it is\ncalled a lazy learner.',
        note: '',
        reversed: false,
        subtopic: 'Fitting algorithm',
      },
      {
        question: 'What is the time cost of `fit`?',
        answer: 'O(nd) to copy the data.',
        note: 'The asymmetry is the point.',
        reversed: false,
        subtopic: 'Fitting algorithm',
      },
      {
        question: 'What happens as k increases?',
        answer: 'The boundary gets smoother.',
        note: '',
        reversed: false,
        subtopic: 'Choice of k',
      },
    ]);
  });

  test('keeps blank lines inside a field and drops them at its ends', () => {
    const { cards } = parseQA('**Q:**\n\nfirst\n\nsecond\n\n**A:** yes\n\n\n');
    assert.equal(cards[0].question, 'first\n\nsecond');
    assert.equal(cards[0].answer, 'yes');
  });

  test('a # title is read and resets the subtopic', () => {
    const { title, cards } = parseQA('# Statistics\n## A\nQ: one\nA: 1\n# Second part\nQ: two\nA: 2\n');
    assert.equal(title, 'Statistics');
    assert.deepEqual(cards.map((c) => c.subtopic), ['A', '']);
  });

  test('Q: and A: work without the bold, in capitals only', () => {
    const { cards, problemCount } = parseQA('Q: capital of Italy?\nA: Rome\n\nQ: next\nA: line one\na: still the answer\n');
    assert.equal(problemCount, 0);
    assert.equal(cards.length, 2);
    assert.equal(cards[1].answer, 'line one\na: still the answer');
  });

  test('bold markers ignore case and accept the colon outside the bold', () => {
    const { cards, problemCount } = parseQA('**q:** one\n**A**: 1\n**NOTE:** n\n');
    assert.equal(problemCount, 0);
    assert.deepEqual(pick(cards[0]), { question: 'one', answer: '1', note: 'n', reversed: false, subtopic: '' });
  });

  test('a plain "Note:" line stays part of the answer', () => {
    const { cards } = parseQA('**Q:** q\n**A:** a\nNote: this only holds for n > 30\n');
    assert.equal(cards[0].answer, 'a\nNote: this only holds for n > 30');
    assert.equal(cards[0].note, '');
  });

  test('**Reversed:** yes marks the card as reversed', () => {
    const { cards } = parseQA('**Q:** ANOVA\n**A:** tests equality of means\n**Reversed:** yes\n\n**Q:** b\n**A:** c\n**Reversed:** no\n');
    assert.deepEqual(cards.map((c) => c.reversed), [true, false]);
  });

  test('nothing inside a code block is a marker or a heading', () => {
    const doc = '**Q:** What does this print?\n```python\n# a comment\n## another\n**A:** not an answer\nQ: nor a question\nprint(1)\n```\n**A:** 1\n';
    const { cards, problemCount, title } = parseQA(doc);
    assert.equal(problemCount, 0);
    assert.equal(title, '');
    assert.equal(cards.length, 1);
    assert.equal(cards[0].question, 'What does this print?\n```python\n# a comment\n## another\n**A:** not an answer\nQ: nor a question\nprint(1)\n```');
    assert.equal(cards[0].answer, '1');
  });

  test('a code block can start on the marker line', () => {
    const { cards } = parseQA('**Q:** q\n**A:** ```r\n# mean\nmean(x)\n```\n');
    assert.equal(cards[0].answer, '```r\n# mean\nmean(x)\n```');
  });

  test('--- between cards is a separator, --- inside a field is content', () => {
    const { cards, problemCount } = parseQA('**Q:** a\n**A:** above\n---\nbelow\n\n---\n\n**Q:** b\n**A:** c\n');
    assert.equal(problemCount, 0);
    assert.equal(cards[0].answer, 'above\n---\nbelow');
    assert.equal(cards[1].question, 'b');
  });

  test('Windows line endings are accepted', () => {
    const { cards } = parseQA('## S\r\n**Q:** a\r\nb\r\n**A:** c\r\n');
    assert.deepEqual(pick(cards[0]), { question: 'a\nb', answer: 'c', note: '', reversed: false, subtopic: 'S' });
  });

  test('untouched template stubs are skipped, and the template itself is clean', () => {
    const { cards, problemCount } = parseQA('**Q:** \n**A:** \n\n**Q:** real\n**A:** card\n\n**Q:**\n**A:**\n');
    assert.equal(problemCount, 0);
    assert.equal(cards.length, 1);
    const template = parseQA(TEMPLATE);
    assert.equal(template.cards.length, 0);
    assert.equal(template.problemCount, 0);
  });

  test('a comment before the cards is ignored', () => {
    const { cards, problemCount } = parseQA('<!-- one line -->\n<!--\nseveral\nlines\n-->\n**Q:** a\n**A:** b\n');
    assert.equal(problemCount, 0);
    assert.equal(cards.length, 1);
  });

  test('reports the line each card starts on', () => {
    const { items } = parseQA('\n\n**Q:** a\n**A:** b\n\n**Q:** c\n**A:** d\n');
    assert.deepEqual(items.map((i) => i.line), [3, 6]);
  });
});

describe('Q&A format: problems', () => {
  const problemsOf = (doc) => parseQA(doc).items.flatMap((i) => (i.kind === 'card' ? i.problems : [i.message]));

  test('a question with no answer', () => {
    const { cards, items } = parseQA('**Q:** a\n\n**Q:** b\n**A:** c\n');
    assert.equal(cards.length, 1);
    assert.deepEqual(items[0].problems, ['Question with no answer']);
    assert.equal(items[0].line, 1);
  });

  test('an empty question or an empty answer', () => {
    assert.deepEqual(problemsOf('**Q:**\n**A:** something\n'), ['Empty question']);
    assert.deepEqual(problemsOf('**Q:** something\n**A:**\n'), ['Empty answer']);
  });

  test('an answer without a question', () => {
    assert.deepEqual(problemsOf('**A:** orphan\n'), ['Answer without a question']);
  });

  test('two answers in one card', () => {
    assert.deepEqual(problemsOf('**Q:** a\n**A:** b\n**A:** c\n'), ['More than one **A:** in the same card']);
  });

  test('text outside a card, grouped by block', () => {
    const { items, cards } = parseQA('Some preamble\nover two lines\n\n**Q:** a\n**A:** b\n');
    assert.equal(cards.length, 1);
    assert.equal(items[0].kind, 'problem');
    assert.equal(items[0].line, 1);
    assert.equal(items[0].text, 'Some preamble\nover two lines');
  });

  test('a **Reversed:** value that is not yes or no', () => {
    assert.deepEqual(problemsOf('**Q:** a\n**A:** b\n**Reversed:** maybe\n'), ['**Reversed:** must be yes or no']);
  });

  test('a code block that is never closed', () => {
    assert.deepEqual(problemsOf('**Q:** a\n**A:** b\n```\ncode\n'), ['Code block is not closed']);
  });

  test('a note outside a card', () => {
    const { items } = parseQA('**Note:** lost\n');
    assert.equal(items[0].kind, 'problem');
  });
});

describe('Q&A format: writing', () => {
  const roundTrip = (entries, options) => parseQA(serializeQA(entries, options));

  test('what is written reads back the same', () => {
    const entries = [
      { question: 'q1', answer: 'a1', note: '', reversed: false, subtopic: '' },
      { question: 'multi\nline\n\nquestion', answer: '- item 1\n- item 2', note: 'a note\nover two lines', reversed: true, subtopic: 'Lists' },
      { question: 'code', answer: '```python\n# comment\n**A:** inside\n```', note: '', reversed: false, subtopic: 'Lists' },
      { question: 'last', answer: '$x_i$', note: '', reversed: false, subtopic: 'Formulas' },
    ];
    const { cards, problemCount, title } = roundTrip(entries, { title: 'My deck' });
    assert.equal(problemCount, 0);
    assert.equal(title, 'My deck');
    assert.deepEqual(cards.map(pick), entries);
  });

  test('content that looks like structure survives', () => {
    const entries = [{
      question: 'What is the output?',
      answer: 'first line\n# looks like a title\n## looks like a subtopic\n**Q:** looks like a question\nA: looks like an answer\n**Note:** looks like a note',
      note: '',
      reversed: false,
      subtopic: '',
    }];
    const { cards, problemCount } = roundTrip(entries);
    assert.equal(problemCount, 0);
    assert.deepEqual(cards.map(pick), entries);
  });

  test('a field whose first line is itself a marker or is indented survives', () => {
    const entries = [
      { question: '**A:** as a question', answer: '    indented code', note: '', reversed: false, subtopic: '' },
    ];
    const { cards } = roundTrip(entries);
    assert.deepEqual(cards.map(pick), entries);
  });

  test('cards without a subtopic are written first, the rest grouped by subtopic', () => {
    const text = serializeQA([
      { question: 'a', answer: '1', subtopic: 'X' },
      { question: 'b', answer: '2', subtopic: '' },
      { question: 'c', answer: '3', subtopic: 'Y' },
      { question: 'd', answer: '4', subtopic: 'X' },
    ]);
    assert.equal(text, '**Q:** b\n**A:** 2\n\n## X\n\n**Q:** a\n**A:** 1\n\n**Q:** d\n**A:** 4\n\n## Y\n\n**Q:** c\n**A:** 3\n');
  });
});
