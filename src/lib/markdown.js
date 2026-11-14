// Pure, lightweight Markdown to HTML converter and Markdown utilities for StudyOS.
// Supports headings, bold, italic, strikethrough, blockquotes, code blocks,
// inline code, bullet & numbered lists, task checkboxes, tables, links, and images.

export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderMarkdown(md) {
  if (!md) return '';
  const text = String(md).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = text.split('\n');
  const output = [];

  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeBlockLines = [];

  let inTable = false;
  let tableLines = [];

  let inList = false;
  let listType = null; // 'ul' | 'ol'
  let taskCount = 0;

  function flushList() {
    if (inList) {
      output.push(listType === 'ul' ? '</ul>' : '</ol>');
      inList = false;
      listType = null;
    }
  }

  function flushTable() {
    if (!inTable) return;
    if (tableLines.length >= 2) {
      let html = '<div class="md-table-wrapper"><table>';
      const headerRow = tableLines[0].trim().replace(/^\||\|$/g, '').split('|');
      html += '<thead><tr>';
      for (const h of headerRow) {
        html += `<th>${inlineMarkdown(h.trim())}</th>`;
      }
      html += '</tr></thead><tbody>';

      // Line 1 is the separator row |---|---|
      for (let i = 2; i < tableLines.length; i++) {
        const row = tableLines[i].trim().replace(/^\||\|$/g, '').split('|');
        html += '<tr>';
        for (let c = 0; c < headerRow.length; c++) {
          const cell = row[c] !== undefined ? row[c].trim() : '';
          html += `<td>${inlineMarkdown(cell)}</td>`;
        }
        html += '</tr>';
      }
      html += '</tbody></table></div>';
      output.push(html);
    }
    inTable = false;
    tableLines = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];

    // 1. Code blocks: ```lang ... ```
    if (rawLine.trim().startsWith('```')) {
      if (inCodeBlock) {
        output.push(`<pre class="md-code-block"><code class="lang-${escapeHtml(codeBlockLang)}">${escapeHtml(codeBlockLines.join('\n'))}</code></pre>`);
        inCodeBlock = false;
        codeBlockLines = [];
        codeBlockLang = '';
      } else {
        flushList();
        flushTable();
        inCodeBlock = true;
        codeBlockLang = rawLine.trim().slice(3).trim();
        codeBlockLines = [];
      }
      continue;
    }
    if (inCodeBlock) {
      codeBlockLines.push(rawLine);
      continue;
    }

    // 2. Tables: lines starting and ending with |
    if (rawLine.trim().startsWith('|') && rawLine.trim().endsWith('|')) {
      flushList();
      inTable = true;
      tableLines.push(rawLine);
      continue;
    } else if (inTable) {
      flushTable();
    }

    const trimmed = rawLine.trim();

    // 3. Blank lines
    if (!trimmed) {
      flushList();
      continue;
    }

    // 4. Horizontal Rule: --- or ***
    if (/^(\-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushList();
      output.push('<hr class="md-hr" />');
      continue;
    }

    // 5. Headings: # .. ######
    const headingMatch = rawLine.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushList();
      const level = headingMatch[1].length;
      const headingText = inlineMarkdown(headingMatch[2].trim());
      output.push(`<h${level} class="md-h${level}">${headingText}</h${level}>`);
      continue;
    }

    // 6. Callout Alert Blocks (> [!NOTE], > [!TIP], > [!WARNING], > [!IMPORTANT])
    const calloutMatch = rawLine.match(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i);
    if (calloutMatch) {
      flushList();
      const kind = calloutMatch[1].toUpperCase();
      const rest = calloutMatch[2].trim();
      const labels = {
        NOTE: 'ملاحظة (NOTE)',
        TIP: 'فائدة / تلميح (TIP)',
        IMPORTANT: 'هام جداً (IMPORTANT)',
        WARNING: 'تحذير (WARNING)',
        CAUTION: 'تنبيه (CAUTION)'
      };
      const label = labels[kind] || kind;
      const body = rest ? `<div class="md-callout-text">${inlineMarkdown(rest)}</div>` : '';
      output.push(`<div class="md-callout md-callout-${kind.toLowerCase()}"><div class="md-callout-header"><span class="md-callout-tag">${label}</span></div>${body}</div>`);
      continue;
    }

    // 7. Blockquote: > ...
    if (rawLine.startsWith('>')) {
      flushList();
      const quoteText = inlineMarkdown(rawLine.replace(/^>\s?/, ''));
      output.push(`<blockquote class="md-blockquote">${quoteText}</blockquote>`);
      continue;
    }

    // 7. Task list item: - [ ] or - [x]
    const taskMatch = rawLine.match(/^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/);
    if (taskMatch) {
      if (!inList || listType !== 'ul') {
        flushList();
        inList = true;
        listType = 'ul';
        output.push('<ul class="md-list md-task-list">');
      }
      const checked = taskMatch[2].toLowerCase() === 'x';
      const itemText = inlineMarkdown(taskMatch[3]);
      const idx = taskCount++;
      output.push(`<li class="md-task-item" data-task-idx="${idx}"><input type="checkbox" class="md-task-checkbox" data-task-index="${idx}" ${checked ? 'checked' : ''} /> <span class="${checked ? 'md-task-done' : ''}">${itemText}</span></li>`);
      continue;
    }

    // 8. Unordered list: - item or * item
    const ulMatch = rawLine.match(/^(\s*)[-*+]\s+(.*)$/);
    if (ulMatch) {
      if (!inList || listType !== 'ul') {
        flushList();
        inList = true;
        listType = 'ul';
        output.push('<ul class="md-list">');
      }
      output.push(`<li>${inlineMarkdown(ulMatch[2])}</li>`);
      continue;
    }

    // 9. Ordered list: 1. item
    const olMatch = rawLine.match(/^(\s*)\d+\.\s+(.*)$/);
    if (olMatch) {
      if (!inList || listType !== 'ol') {
        flushList();
        inList = true;
        listType = 'ol';
        output.push('<ol class="md-list">');
      }
      output.push(`<li>${inlineMarkdown(olMatch[2])}</li>`);
      continue;
    }

    // Regular paragraph
    flushList();
    output.push(`<p class="md-p">${inlineMarkdown(rawLine)}</p>`);
  }

  if (inCodeBlock) {
    output.push(`<pre class="md-code-block"><code>${escapeHtml(codeBlockLines.join('\n'))}</code></pre>`);
  }
  flushList();
  flushTable();

  return output.join('\n');
}

export function inlineMarkdown(str) {
  if (!str) return '';
  let out = escapeHtml(str);

  // Images: ![alt](url)
  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, url) => {
    return `<span class="md-img-container"><img class="md-img" src="${url}" alt="${alt}" loading="lazy" /></span>`;
  });

  // Links: [text](url)
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, url) => {
    return `<a class="md-link" href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });

  // Highlight: ==text==
  out = out.replace(/==([^=]+)==/g, '<mark class="md-highlight">$1</mark>');

  // Underline: <u>text</u> or ++text++
  out = out.replace(/&lt;u&gt;([\s\S]*?)&lt;\/u&gt;/gi, '<u class="md-underline">$1</u>');
  out = out.replace(/<u>([\s\S]*?)<\/u>/gi, '<u class="md-underline">$1</u>');
  out = out.replace(/\+\+([^+]+)\+\+/g, '<u class="md-underline">$1</u>');

  // Spoiler / Blur: ||text||
  out = out.replace(/\|\|([^|]+)\|\|/g, '<span class="md-spoiler" title="اضغط للإظهار" onclick="this.classList.toggle(\'revealed\')">$1</span>');

  // Subscript & Superscript: ~sub~ and ^sup^
  out = out.replace(/~([^~]+)~/g, '<sub>$1</sub>');
  out = out.replace(/\^([^^]+)\^/g, '<sup>$1</sup>');

  // Inline code: `code`
  out = out.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');

  // Bold & Italic: ***text***
  out = out.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');

  // Bold: **text** or __text__
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');

  // Strikethrough: ~~text~~
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');

  // Italic: *text* or _text_
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  out = out.replace(/_([^_]+)_/g, '<em>$1</em>');

  // Arabic quotes: «text»
  out = out.replace(/«([^»]+)»/g, '<span class="md-ar-quote">«$1»</span>');

  // Timestamps: [mm:ss] or [hh:mm:ss]
  out = out.replace(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g, '<span class="md-timestamp">[$1]</span>');

  return out;
}

// Download markdown as .md file
export function exportMarkdownFile(title, content) {
  const filename = `${(title || 'Note').replace(/[/\\?%*:|"<>]/g, '_').trim() || 'Note'}.md`;
  const blob = new Blob([content || ''], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Print markdown as formatted PDF via browser printing
export function exportMarkdownAsPdf(title, content) {
  const htmlBody = renderMarkdown(content);
  const printWindow = window.open('', '_blank', 'width=900,height=750');
  if (!printWindow) return false;

  const doc = printWindow.document;
  doc.open();
  doc.write(`
    <!DOCTYPE html>
    <html dir="auto">
    <head>
      <meta charset="utf-8" />
      <title>${escapeHtml(title || 'Note')}</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Cairo", "Noto Sans Arabic", Tahoma, Arial, sans-serif;
          color: #1a1a1a;
          background: #ffffff;
          line-height: 1.65;
          padding: 40px;
          margin: 0;
        }
        h1, h2, h3, h4, h5, h6 { color: #0f172a; margin-top: 1.4em; margin-bottom: 0.6em; }
        h1 { font-size: 26px; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; }
        h2 { font-size: 20px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
        p { margin: 0.8em 0; }
        code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 13px; }
        pre { background: #0f172a; color: #f8fafc; padding: 14px; border-radius: 6px; overflow-x: auto; }
        pre code { background: transparent; color: inherit; padding: 0; }
        blockquote { border-inline-start: 4px solid #3b82f6; margin: 1em 0; padding: 6px 14px; background: #f8fafc; color: #475569; }
        .md-callout { border-radius: 6px; padding: 10px 14px; margin: 1em 0; border: 1px solid #e2e8f0; border-inline-start-width: 4px; }
        .md-callout-note { background: #f0f9ff; border-inline-start-color: #0284c7; }
        .md-callout-tip { background: #f0fdf4; border-inline-start-color: #16a34a; }
        .md-callout-important { background: #faf5ff; border-inline-start-color: #9333ea; }
        .md-callout-warning, .md-callout-caution { background: #fffbeb; border-inline-start-color: #d97706; }
        .md-callout-tag { font-weight: 700; font-size: 12px; margin-bottom: 4px; display: inline-block; }
        .md-ar-quote { font-weight: 600; color: #1e3a8a; }
        .md-timestamp { display: inline-block; background: #e0f2fe; color: #0369a1; padding: 1px 6px; border-radius: 4px; font-size: 12px; font-weight: 600; }
        table { border-collapse: collapse; width: 100%; margin: 1.2em 0; }
        th, td { border: 1px solid #cbd5e1; padding: 8px 12px; text-align: start; }
        th { background: #f1f5f9; font-weight: 600; }
        img { max-width: 100%; height: auto; border-radius: 6px; margin: 10px 0; border: 1px solid #e2e8f0; }
        ul, ol { padding-inline-start: 24px; margin: 0.8em 0; }
        li { margin: 0.3em 0; }
        @media print {
          body { padding: 0; }
          button { display: none; }
        }
      </style>
    </head>
    <body>
      <h1>${escapeHtml(title || 'Note')}</h1>
      ${htmlBody}
      <script>
        window.onload = function() {
          setTimeout(function() {
            window.print();
          }, 300);
        };
      <\/script>
    </body>
    </html>
  `);
  doc.close();
  return true;
}

export function toggleMarkdownTask(markdown, targetIndex) {
  if (!markdown) return '';
  const lines = markdown.split('\n');
  let currentTaskIdx = 0;
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const taskMatch = lines[i].match(/^(\s*[-*+]\s+\[)([ xX])(\]\s+.*)$/);
    if (taskMatch) {
      if (currentTaskIdx === targetIndex) {
        const nextState = taskMatch[2].toLowerCase() === 'x' ? ' ' : 'x';
        lines[i] = `${taskMatch[1]}${nextState}${taskMatch[3]}`;
        return lines.join('\n');
      }
      currentTaskIdx++;
    }
  }
  return markdown;
}
