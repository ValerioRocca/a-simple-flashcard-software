import { describe, test, assert } from './harness.js';
import { markdownToHtml, toPlainText } from '../js/core/markdown.js';

/** The formulas found in the text, as [display, tex] pairs. */
function formulas(src) {
  const html = markdownToHtml(src);
  return [...html.matchAll(/data-display="(\d)" data-tex="([^"]*)"/g)].map((m) => [
    Number(m[1]),
    m[2].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'),
  ]);
}

describe('Markdown', () => {
  test('bold, italic, lists, links and code', () => {
    const html = markdownToHtml('**bold** and *italic* and `code`\n\n- one\n- two\n\n[link](https://example.org)');
    assert.match(html, /<strong>bold<\/strong>/);
    assert.match(html, /<em>italic<\/em>/);
    assert.match(html, /<code>code<\/code>/);
    assert.match(html, /<ul>\s*<li>one<\/li>\s*<li>two<\/li>\s*<\/ul>/);
    assert.match(html, /<a href="https:\/\/example.org">link<\/a>/);
  });

  test('a single line break is kept', () => {
    assert.match(markdownToHtml('first\nsecond'), /first<br>\s*second/);
  });

  test('html such as <br> passes through for the sanitiser to judge', () => {
    assert.match(markdownToHtml('a<br>b'), /a<br>b/);
  });
});

describe('Formulas', () => {
  test('$…$ is an inline formula and its LaTeX is left untouched', () => {
    assert.deepEqual(formulas('the mean $\\bar{x}_i = \\frac{1}{n}\\sum_{i} x_i$ of *n* values'), [
      [0, '\\bar{x}_i = \\frac{1}{n}\\sum_{i} x_i'],
    ]);
    const html = markdownToHtml('$a_1 * b_2 * c_3$');
    assert.equal(html.includes('<em>'), false);
  });

  test('[$]…[/$] inside a sentence is inline, alone on its line is a display formula', () => {
    const src = '[$] \\min_{w} \\frac{||w||^{2}}{2} [/$], subject to\n[$] y_{i} (w \\cdot x_{i} + b) \\geq 1 [/$]';
    assert.deepEqual(formulas(src), [
      [0, '\\min_{w} \\frac{||w||^{2}}{2}'],
      [1, 'y_{i} (w \\cdot x_{i} + b) \\geq 1'],
    ]);
  });

  test('$$…$$, \\[…\\] and [$$]…[/$$] are display formulas, also over several lines', () => {
    assert.deepEqual(formulas('$$\na = b\n$$'), [[1, 'a = b']]);
    assert.deepEqual(formulas('text before\n$$x^2$$\ntext after'), [[1, 'x^2']]);
    assert.deepEqual(formulas('\\[ \\int_0^1 f \\]'), [[1, '\\int_0^1 f']]);
    assert.deepEqual(formulas('[$$] e^{i\\pi} [/$$]'), [[1, 'e^{i\\pi}']]);
    assert.deepEqual(formulas('inline $$x$$ display'), [[1, 'x']]);
  });

  test('\\(…\\) is an inline formula', () => {
    assert.deepEqual(formulas('so \\(x_1 < x_2\\) holds'), [[0, 'x_1 < x_2']]);
  });

  test('prices are not formulas', () => {
    assert.deepEqual(formulas('it costs $5 and then $10'), []);
    assert.deepEqual(formulas('from $5/$10 to $ 3 $'), []);
    assert.deepEqual(formulas('only one $ sign'), []);
  });

  test('dollar signs inside code are not formulas', () => {
    assert.deepEqual(formulas('use `$x$` in the text'), []);
    assert.deepEqual(formulas('```\n$$\nx\n$$\n```'), []);
  });

  test('several formulas in one line', () => {
    assert.deepEqual(formulas('$a$ and $b$, then [$]c[/$]'), [[0, 'a'], [0, 'b'], [0, 'c']]);
  });

  test('quotes and angle brackets in LaTeX are escaped in the placeholder', () => {
    const html = markdownToHtml('$a < b \\text{ "q" } & c$');
    assert.match(html, /data-tex="a &lt; b \\text\{ &quot;q&quot; \} &amp; c"/);
    assert.deepEqual(formulas('$a < b \\text{ "q" } & c$'), [[0, 'a < b \\text{ "q" } & c']]);
  });

  test('an escaped dollar inside a formula does not end it', () => {
    assert.deepEqual(formulas('$\\$5 + x$'), [[0, '\\$5 + x']]);
  });

  test('a formula inside a list item and inside bold text', () => {
    assert.deepEqual(formulas('- first $x_1$\n- second **bold $y_2$**'), [[0, 'x_1'], [0, 'y_2']]);
  });
});

describe('Plain text of a card side', () => {
  test('strips the markup and joins the lines', () => {
    assert.equal(toPlainText('**Bold** start\n\n- item `code`\n- [link](http://x.y)'), 'Bold start item code link');
    assert.equal(toPlainText('see ![chart](images/a.png) and <img src="images/b.png">'), 'see [chart] and [image]');
    assert.equal(toPlainText('[$] x_i [/$] is $y$'), 'x_i is $y$');
  });

  test('emphasis marks go, underscores and stars that are not emphasis stay', () => {
    assert.equal(toPlainText('What is a *p*-value, _really_?'), 'What is a p-value, really?');
    assert.equal(toPlainText('use my_var_name and x_i * y_i * z'), 'use my_var_name and x_i * y_i * z');
  });

  test('long text is cut', () => {
    const text = toPlainText('word '.repeat(100), 20);
    assert.equal(text.length, 20);
    assert.ok(text.endsWith('…'));
  });
});
