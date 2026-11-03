// Toolbar item catalogue and order helpers. The actual buttons live in
// Reader.svelte; this module only owns the stable ids, default order and the
// pure reordering operations, so the customisation UI is easy to test.

export const DEFAULT_BAR_ITEMS = [
  { id: 'tabs', label: 'reader.tabs', kind: 'action' },
  { id: 'fullscreen', label: 'reader.fullscreen', kind: 'action' },
  { id: 'side-images', label: 'side.images', kind: 'action' },
  { id: 'side-pages', label: 'side.pages', kind: 'action' },
  { id: 'side-bookmarks', label: 'side.bookmarks', kind: 'action' },
  { id: 'direction', label: 'reader.readingDirection', kind: 'menu' },
  { id: 'layout', label: 'reader.layout', kind: 'menu' },
  { id: 'mode', label: 'reader.readingMode', kind: 'menu' },
  { id: 'prev', label: 'reader.previousPage', kind: 'action' },
  { id: 'page', label: 'reader.pageNumber', kind: 'control' },
  { id: 'next', label: 'reader.nextPage', kind: 'action' },
  { id: 'zoom-out', label: 'reader.zoomOut', kind: 'action' },
  { id: 'zoom', label: 'reader.zoom', kind: 'control' },
  { id: 'zoom-in', label: 'reader.zoomIn', kind: 'action' },
  { id: 'fit', label: 'reader.fitWidth', kind: 'action' },
  { id: 'rotate-left', label: 'reader.rotateLeft', kind: 'action' },
  { id: 'rotate-right', label: 'reader.rotateRight', kind: 'action' },
  { id: 'tool-select', label: 'tool.select', kind: 'tool' },
  { id: 'tool-hand', label: 'tool.hand', kind: 'tool' },
  { id: 'tool-text', label: 'tool.text', kind: 'tool' },
  { id: 'tool-marker', label: 'tool.marker', kind: 'tool', repeat: 'marker' },
  { id: 'tool-shape', label: 'tool.shape', kind: 'tool', repeat: 'shape' },
  { id: 'tool-pen', label: 'tool.pen', kind: 'tool', repeat: 'pen' },
  { id: 'tool-pointer', label: 'tool.pointer', kind: 'tool' },
  { id: 'tool-eraser', label: 'tool.eraser', kind: 'tool' },
  { id: 'tool-capture', label: 'tool.capture', kind: 'tool' },
  { id: 'tool-bookmark', label: 'tool.bookmark', kind: 'tool' },
  { id: 'colors', label: 'tool.color', kind: 'group' },
  { id: 'size', label: 'tool.size', kind: 'group' },
  { id: 'shapes', label: 'tool.shape', kind: 'group' },
  { id: 'undo', label: 'reader.undo', kind: 'action' },
  { id: 'redo', label: 'reader.redo', kind: 'action' },
  { id: 'bookmark-page', label: 'reader.bookmarkPage', kind: 'action' },
  { id: 'save', label: 'reader.saveCopy', kind: 'action' },
  { id: 'search', label: 'reader.search', kind: 'action' },
  { id: 'display', label: 'reader.display', kind: 'menu' },
  { id: 'export', label: 'common.export', kind: 'menu' },
  { id: 'settings', label: 'reader.toolbarSettings', kind: 'action' },
  { id: 'status', label: 'reader.saved', kind: 'status' }
];

export const BAR_ITEM_IDS = DEFAULT_BAR_ITEMS.map((item) => item.id);
const DEFAULT_ORDER = [...BAR_ITEM_IDS];

export function defaultBarOrder() {
  return [...DEFAULT_ORDER];
}

// Keep every built-in item exactly once and append custom items that are still
// present. Unknown ids from an older build are dropped without losing the rest.
export function normalizeBarOrder(saved, customIds = []) {
  const valid = new Set([...BAR_ITEM_IDS, ...customIds]);
  const out = [];
  const seen = new Set();
  if (Array.isArray(saved)) {
    for (const id of saved) {
      if (typeof id !== 'string' || !valid.has(id) || seen.has(id)) continue;
      out.push(id);
      seen.add(id);
    }
  }
  for (const id of DEFAULT_ORDER) {
    if (!seen.has(id)) {
      out.push(id);
      seen.add(id);
    }
  }
  for (const id of customIds) {
    if (!seen.has(id)) {
      out.push(id);
      seen.add(id);
    }
  }
  return out;
}

export function moveBarOrder(order, id, delta) {
  const list = Array.isArray(order) ? [...order] : defaultBarOrder();
  const index = list.indexOf(id);
  if (index < 0 || !delta) return list;
  const target = Math.max(0, Math.min(list.length - 1, index + delta));
  if (target === index) return list;
  list.splice(index, 1);
  list.splice(target, 0, id);
  return list;
}

export function insertAfterBarItem(order, afterId, id) {
  const list = Array.isArray(order) ? [...order] : defaultBarOrder();
  const existing = list.indexOf(id);
  if (existing >= 0) list.splice(existing, 1);
  const anchor = list.indexOf(afterId);
  if (anchor < 0) list.push(id);
  else list.splice(anchor + 1, 0, id);
  return list;
}

export function removeBarItem(order, id) {
  return (Array.isArray(order) ? order : defaultBarOrder()).filter((item) => item !== id);
}

export function barOrderMap(order) {
  const list = Array.isArray(order) && order.length ? order : defaultBarOrder();
  const map = {};
  list.forEach((id, index) => { map[id] = index; });
  return map;
}
