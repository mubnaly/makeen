// Utility functions for Markdown Editor UX (auto-continuation, indentation, shortcuts)

/**
 * Analyzes the current line text to determine whether it should auto-continue
 * a list (tasks, bullets, numbered lists, blockquotes) or exit the list when empty.
 * 
 * @param {string} lineText The text of the current line up to the cursor
 * @returns {{ exit?: boolean, continuation?: string, prefixLength?: number } | null}
 */
export function getAutoListContinuation(lineText) {
  if (typeof lineText !== 'string') return null;

  // 1. Task lists: e.g. "- [ ] ", "* [ ] ", "+ [x] ", "  - [ ] "
  const taskMatch = lineText.match(/^(\s*[-*+]\s+\[[ xX]\]\s*)(.*)$/);
  if (taskMatch) {
    const prefix = taskMatch[1];
    const text = taskMatch[2];
    if (!text.trim()) {
      // Empty task item: user pressed enter with no text -> exit list
      return { exit: true, prefixLength: prefix.length };
    }
    // Extract base indent and bullet symbol to continue with an unchecked task
    const indentMatch = prefix.match(/^(\s*[-*+]\s+)/);
    const baseBullet = indentMatch ? indentMatch[1] : '- ';
    return { continuation: `${baseBullet}[ ] ` };
  }

  // 2. Bullet lists: e.g. "- ", "* ", "+ ", "  - "
  const bulletMatch = lineText.match(/^(\s*[-*+]\s+)(.*)$/);
  if (bulletMatch) {
    const prefix = bulletMatch[1];
    const text = bulletMatch[2];
    if (!text.trim()) {
      return { exit: true, prefixLength: prefix.length };
    }
    return { continuation: prefix };
  }

  // 3. Numbered lists: e.g. "1. ", "  12. "
  const numMatch = lineText.match(/^(\s*)(\d+)\.\s+(.*)$/);
  if (numMatch) {
    const indent = numMatch[1];
    const num = parseInt(numMatch[2], 10);
    const text = numMatch[3];
    if (!text.trim()) {
      return { exit: true, prefixLength: lineText.length };
    }
    return { continuation: `${indent}${num + 1}. ` };
  }

  // 4. Blockquotes: e.g. "> ", "  > "
  const quoteMatch = lineText.match(/^(\s*>\s*)(.*)$/);
  if (quoteMatch) {
    const prefix = quoteMatch[1];
    const text = quoteMatch[2];
    if (!text.trim()) {
      return { exit: true, prefixLength: prefix.length };
    }
    return { continuation: prefix.endsWith(' ') ? prefix : `${prefix} ` };
  }

  return null;
}

/**
 * Handles the Enter key in a Markdown textarea.
 * 
 * @param {string} content The current textarea content
 * @param {number} selectionStart Cursor start position
 * @param {number} selectionEnd Cursor end position
 * @returns {{ content: string, newCursor: number } | null}
 */
export function processMarkdownEnter(content, selectionStart, selectionEnd) {
  const textBefore = content.slice(0, selectionStart);
  const textAfter = content.slice(selectionEnd);

  const lastNewline = textBefore.lastIndexOf('\n');
  const lineStart = lastNewline === -1 ? 0 : lastNewline + 1;
  const currentLine = textBefore.slice(lineStart);

  const action = getAutoListContinuation(currentLine);
  if (!action) return null;

  if (action.exit) {
    // Erase the empty prefix on the current line and create an empty line
    const beforeLine = content.slice(0, lineStart);
    const newContent = beforeLine + '\n' + textAfter;
    return {
      content: newContent,
      newCursor: lineStart
    };
  }

  if (action.continuation) {
    const insert = '\n' + action.continuation;
    const newContent = textBefore + insert + textAfter;
    return {
      content: newContent,
      newCursor: selectionStart + insert.length
    };
  }

  return null;
}

/**
 * Handles Tab or Shift+Tab indentation for lines in a Markdown textarea.
 * 
 * @param {string} content 
 * @param {number} selectionStart 
 * @param {number} selectionEnd 
 * @param {boolean} outdent True if Shift+Tab
 * @returns {{ content: string, newStart: number, newEnd: number } | null}
 */
export function processMarkdownTab(content, selectionStart, selectionEnd, outdent = false) {
  const lastNewline = content.slice(0, selectionStart).lastIndexOf('\n');
  const lineStart = lastNewline === -1 ? 0 : lastNewline + 1;

  if (!outdent) {
    // Indent with 2 spaces
    const indent = '  ';
    const newContent = content.slice(0, lineStart) + indent + content.slice(lineStart);
    return {
      content: newContent,
      newStart: selectionStart + 2,
      newEnd: selectionEnd + 2
    };
  } else {
    // Outdent up to 2 spaces if present at line start
    const linePrefix = content.slice(lineStart, lineStart + 2);
    let removeCount = 0;
    if (linePrefix.startsWith('  ')) removeCount = 2;
    else if (linePrefix.startsWith(' ') || linePrefix.startsWith('\t')) removeCount = 1;

    if (removeCount === 0) return null;

    const newContent = content.slice(0, lineStart) + content.slice(lineStart + removeCount);
    return {
      content: newContent,
      newStart: Math.max(lineStart, selectionStart - removeCount),
      newEnd: Math.max(lineStart, selectionEnd - removeCount)
    };
  }
}
