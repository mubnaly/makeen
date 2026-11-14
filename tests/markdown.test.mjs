import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, inlineMarkdown, escapeHtml } from '../src/lib/markdown.js';

test('escapeHtml prevents XSS', () => {
  assert.equal(escapeHtml('<script>alert("xss")</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
});

test('renderMarkdown converts headings and paragraphs', () => {
  const md = '# Header 1\n## Header 2\nHello world';
  const html = renderMarkdown(md);
  assert.ok(html.includes('<h1 class="md-h1">Header 1</h1>'));
  assert.ok(html.includes('<h2 class="md-h2">Header 2</h2>'));
  assert.ok(html.includes('<p class="md-p">Hello world</p>'));
});

test('renderMarkdown handles lists and task items', () => {
  const md = '- Item A\n- Item B\n- [x] Completed task\n- [ ] Pending task';
  const html = renderMarkdown(md);
  assert.ok(html.includes('<li>Item A</li>'));
  assert.ok(html.includes('checked'));
  assert.ok(html.includes('Pending task'));
});

test('renderMarkdown handles code blocks', () => {
  const md = '```js\nconst x = 42;\n```';
  const html = renderMarkdown(md);
  assert.ok(html.includes('<pre class="md-code-block"><code class="lang-js">const x = 42;</code></pre>'));
});

test('renderMarkdown handles tables', () => {
  const md = '| Col 1 | Col 2 |\n|---|---|\n| Val 1 | Val 2 |';
  const html = renderMarkdown(md);
  assert.ok(html.includes('<table>'));
  assert.ok(html.includes('<th>Col 1</th>'));
  assert.ok(html.includes('<td>Val 1</td>'));
});

test('inlineMarkdown parses bold, italic, links, images, underline, and highlight', () => {
  const res = inlineMarkdown('**bold** *italic* [link](https://example.com) ![pic](img.png) <u>underlined</u> ==highlighted==');
  assert.ok(res.includes('<strong>bold</strong>'));
  assert.ok(res.includes('<em>italic</em>'));
  assert.ok(res.includes('<a class="md-link" href="https://example.com"'));
  assert.ok(res.includes('<img class="md-img" src="img.png" alt="pic"'));
  assert.ok(res.includes('<u class="md-underline">underlined</u>'));
  assert.ok(res.includes('<mark class="md-highlight">highlighted</mark>'));
});
