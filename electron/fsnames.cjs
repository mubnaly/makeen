'use strict';

// Filenames are user-visible: "محاضرة — transcript.pdf" must keep its Arabic
// instead of collapsing to underscores. This is deliberately stricter than a
// plain basename(): it strips directory components and Windows-reserved
// characters, removes leading dots (no hidden/traversal names), and rejects
// device names such as CON or NUL.

const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

function safeFileName(value, fallback = 'file') {
  const leaf = String(value ?? '').split(/[\\/]/).pop() || '';
  let out = leaf
    .replace(/[<>:"|?*\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+\./g, '.')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 120)
    .trim();
  if (!out) out = String(fallback || 'file');
  if (RESERVED_NAME.test(out)) out = `_${out}`;
  return out;
}

module.exports = { safeFileName };
