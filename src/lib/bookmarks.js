// Hierarchical Bookmarks for PDF reading (book-style chapters & sub-chapters).
// Supports tree hierarchy, nesting, drag-and-drop reordering, and collapsible branches.

export function normalizeBookmark(b) {
  if (!b) return null;
  const hasPage = typeof b.page === 'number' && b.page >= 1;
  const hasAt = typeof b.at === 'number' && b.at >= 0;
  if (!hasPage && !hasAt) return null;
  return {
    id: b.id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())),
    page: hasPage ? b.page : undefined,
    at: hasAt ? b.at : undefined,
    note: typeof b.note === 'string' ? b.note : '',
    title: typeof b.title === 'string' ? b.title : (b.note || ''),
    u: typeof b.u === 'number' ? b.u : undefined,
    v: typeof b.v === 'number' ? b.v : undefined,
    parentId: b.parentId ? String(b.parentId) : null,
    order: typeof b.order === 'number' ? b.order : 0,
    collapsed: Boolean(b.collapsed),
    createdAt: b.createdAt || Date.now()
  };
}

export function normalizeBookmarks(list) {
  if (!Array.isArray(list)) return [];
  const normalized = [];
  for (const item of list) {
    const nb = normalizeBookmark(item);
    if (nb) normalized.push(nb);
  }
  return normalized;
}

export function getBookmarkDescendants(list, parentId) {
  const set = new Set();
  const queue = [parentId];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const b of list) {
      if (b.parentId === current && !set.has(b.id)) {
        set.add(b.id);
        queue.push(b.id);
      }
    }
  }
  return set;
}

export function buildBookmarkTree(list) {
  const items = normalizeBookmarks(list);
  const byId = new Map(items.map((b) => [b.id, { ...b, children: [] }]));
  const roots = [];

  for (const item of byId.values()) {
    if (item.parentId && byId.has(item.parentId)) {
      byId.get(item.parentId).children.push(item);
    } else {
      item.parentId = null;
      roots.push(item);
    }
  }

  const sortFn = (a, b) =>
    (a.order - b.order) ||
    ((a.page ?? a.at ?? 0) - (b.page ?? b.at ?? 0)) ||
    (a.createdAt - b.createdAt);
  const sortRecursive = (node) => {
    node.children.sort(sortFn);
    node.children.forEach(sortRecursive);
  };

  roots.sort(sortFn);
  roots.forEach(sortRecursive);
  return roots;
}

export function flattenBookmarkTree(list) {
  const roots = buildBookmarkTree(list);
  const flat = [];

  function traverse(nodes, depth, parentVisible) {
    for (const node of nodes) {
      const visible = parentVisible;
      const hasChildren = node.children.length > 0;
      flat.push({
        ...node,
        depth,
        hasChildren,
        visible
      });
      if (hasChildren) {
        traverse(node.children, depth + 1, visible && !node.collapsed);
      }
    }
  }

  traverse(roots, 0, true);
  return flat;
}

export function reorderBookmarks(list, sourceId, targetId, position = 'after') {
  if (sourceId === targetId) return list;
  const items = normalizeBookmarks(list).map((b) => ({ ...b }));
  const source = items.find((b) => b.id === sourceId);
  const target = items.find((b) => b.id === targetId);
  if (!source || !target) return items;

  // Prevent circular nesting
  const descendants = getBookmarkDescendants(items, sourceId);
  if (descendants.has(targetId)) return items;

  if (position === 'inside') {
    source.parentId = target.id;
    target.collapsed = false; // Auto-expand target so new child is visible
    // Put at end of target's existing children
    const siblingOrders = items.filter((b) => b.parentId === target.id && b.id !== sourceId).map((b) => b.order);
    source.order = siblingOrders.length > 0 ? Math.max(...siblingOrders) + 10 : 10;
  } else {
    source.parentId = target.parentId;
    const siblings = items
      .filter((b) => b.parentId === target.parentId && b.id !== sourceId)
      .sort((a, b) => a.order - b.order);
    const targetIdx = siblings.findIndex((b) => b.id === targetId);
    const insertIdx = position === 'before' ? targetIdx : targetIdx + 1;
    siblings.splice(insertIdx, 0, source);
    siblings.forEach((b, idx) => {
      b.order = (idx + 1) * 10;
    });
  }

  return items;
}

export function indentBookmark(list, id) {
  const flat = flattenBookmarkTree(list);
  const idx = flat.findIndex((b) => b.id === id);
  if (idx <= 0) return list;
  const target = flat[idx];
  // Find immediate previous sibling or item at same depth
  let prevSibling = null;
  for (let i = idx - 1; i >= 0; i--) {
    if (flat[i].depth === target.depth && flat[i].parentId === target.parentId) {
      prevSibling = flat[i];
      break;
    }
  }
  if (!prevSibling) return list;
  return reorderBookmarks(list, id, prevSibling.id, 'inside');
}

export function outdentBookmark(list, id) {
  const items = normalizeBookmarks(list).map((b) => ({ ...b }));
  const target = items.find((b) => b.id === id);
  if (!target || !target.parentId) return items;

  const parent = items.find((b) => b.id === target.parentId);
  if (!parent) {
    target.parentId = null;
    return items;
  }

  return reorderBookmarks(items, id, parent.id, 'after');
}

export function setBookmarkTitle(list, id, title) {
  return normalizeBookmarks(list).map((b) => (b.id === id ? { ...b, title: String(title || '').trim() } : b));
}

export function toggleBookmarkCollapse(list, id) {
  return normalizeBookmarks(list).map((b) => (b.id === id ? { ...b, collapsed: !b.collapsed } : b));
}
