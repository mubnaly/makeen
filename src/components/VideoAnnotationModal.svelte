<script>
  // VideoAnnotationModal: In-place markup and object-based annotation for video screenshots.
  // Supports selectable, movable, and resizable annotation objects (text, shapes, pen, marker),
  // font family (Cairo, Amiri, Tajawal, etc.), font size customization, accurate in-place text positioning,
  // dedicated Objects & Layers sidebar, and lossless image saving.

  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { t } from '../lib/lang.svelte.js';
  import { ANNOTATION_FONTS, DEFAULT_ANNOTATION_FONT } from '../lib/fonts.js';

  let {
    imageSrc = '',
    timecode = '',
    onSave = () => {},
    onCancel = () => {}
  } = $props();

  const tr = (k, p) => t(k, p);

  const COLORS = [
    '#f59e0b', // Yellow
    '#f97316', // Orange
    '#ef4444', // Red
    '#10b981', // Green
    '#3b82f6', // Blue
    '#8b5cf6', // Purple
    '#ffffff', // White
    '#111827'  // Black
  ];

  const SIZES = [2, 4, 8, 14];

  let currentTool = $state('select'); // 'select' | 'pen' | 'marker' | 'rect' | 'ellipse' | 'arrow' | 'line' | 'text' | 'eraser'
  let currentColor = $state('#ef4444');
  let currentSize = $state(4);
  let textFontSize = $state(28);
  let textFontFamily = $state(DEFAULT_ANNOTATION_FONT);

  let canvasEl = $state(null);
  let containerEl = $state(null);
  let baseImg = $state(null);
  let isDrawing = false;
  let isDraggingSelected = false;
  let isResizing = false;
  let activeHandle = null; // 'nw' | 'ne' | 'se' | 'sw'
  let dragOffset = { x: 0, y: 0 };
  let resizeOrigin = null;
  let startX = 0;
  let startY = 0;

  // History stack for undo/redo
  let history = $state([]);
  let redoStack = $state([]);
  let selectedObjectId = $state(null);

  // Dedicated Objects Sidebar (visible on select tool or toggled)
  let objectsSidebarOpen = $state(true);

  // Active text editing popup
  let activeTextObj = $state(null); // { id, canvasX, canvasY, screenX, screenY, color, fontSize, fontFamily }
  let textInputVal = $state('');

  const selectedItem = $derived(history.find((item) => item.id === selectedObjectId) || null);

  onMount(() => {
    initCanvas();
  });

  function initCanvas() {
    if (!canvasEl || !imageSrc) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      baseImg = img;
      const natW = img.naturalWidth || 1280;
      const natH = img.naturalHeight || 720;
      const aspect = natW / (natH || 1);
      const targetW = Math.max(1280, natW);
      const targetH = Math.round(targetW / aspect);
      canvasEl.width = targetW;
      canvasEl.height = targetH;
      redrawAll();
    };
    img.src = imageSrc;
  }

  function redrawAll() {
    if (!canvasEl) return;
    const ctx = canvasEl.getContext('2d');
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

    // 1. Draw base video frame
    if (baseImg) {
      ctx.drawImage(baseImg, 0, 0, canvasEl.width, canvasEl.height);
    }

    // 2. Draw all committed annotation objects
    for (const item of history) {
      drawItem(ctx, item, item.id === selectedObjectId);
    }
  }

  function drawItem(ctx, item, isSelected = false) {
    ctx.save();
    ctx.lineWidth = item.size || 4;
    ctx.strokeStyle = item.color || '#ef4444';
    ctx.fillStyle = item.color || '#ef4444';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (item.tool === 'marker') {
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = (item.size || 4) * 2.5;
    }

    if (item.tool === 'pen' || item.tool === 'marker') {
      if (item.points && item.points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(item.points[0].x, item.points[0].y);
        for (let i = 1; i < item.points.length; i++) {
          ctx.lineTo(item.points[i].x, item.points[i].y);
        }
        ctx.stroke();
      }
    } else if (item.tool === 'rect') {
      ctx.strokeRect(item.x, item.y, item.w, item.h);
    } else if (item.tool === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(
        item.x + item.w / 2, item.y + item.h / 2,
        Math.abs(item.w / 2), Math.abs(item.h / 2),
        0, 0, Math.PI * 2
      );
      ctx.stroke();
    } else if (item.tool === 'line') {
      ctx.beginPath();
      ctx.moveTo(item.x1, item.y1);
      ctx.lineTo(item.x2, item.y2);
      ctx.stroke();
    } else if (item.tool === 'arrow') {
      drawArrow(ctx, item.x1, item.y1, item.x2, item.y2, item.size || 4);
    } else if (item.tool === 'text') {
      const fSize = item.fontSize || 28;
      const fFamily = item.fontFamily || DEFAULT_ANNOTATION_FONT;
      ctx.font = `bold ${fSize}px ${fFamily}`;
      ctx.fillText(item.text, item.x, item.y);
    }

    // Selection highlight outline & handles
    if (isSelected) {
      drawSelectionOutline(ctx, item);
    }

    ctx.restore();
  }

  function drawSelectionOutline(ctx, item) {
    ctx.save();
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);

    const bounds = getItemBounds(ctx, item);
    if (bounds) {
      const pad = 8;
      ctx.strokeRect(bounds.x - pad, bounds.y - pad, bounds.w + pad * 2, bounds.h + pad * 2);

      // Corner handles
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      const sz = 10;
      const handles = getCornerHandles(bounds, pad);

      for (const h of Object.values(handles)) {
        ctx.fillRect(h.x - sz / 2, h.y - sz / 2, sz, sz);
        ctx.strokeRect(h.x - sz / 2, h.y - sz / 2, sz, sz);
      }
    }
    ctx.restore();
  }

  function getCornerHandles(bounds, pad = 8) {
    return {
      nw: { x: bounds.x - pad, y: bounds.y - pad },
      ne: { x: bounds.x + bounds.w + pad, y: bounds.y - pad },
      se: { x: bounds.x + bounds.w + pad, y: bounds.y + bounds.h + pad },
      sw: { x: bounds.x - pad, y: bounds.y + bounds.h + pad }
    };
  }

  function getItemBounds(ctx, item) {
    if (!item) return null;
    if (item.tool === 'text') {
      const fSize = item.fontSize || 28;
      const fFamily = item.fontFamily || DEFAULT_ANNOTATION_FONT;
      ctx.font = `bold ${fSize}px ${fFamily}`;
      const metrics = ctx.measureText(item.text || '');
      return {
        x: item.x,
        y: item.y - fSize,
        w: metrics.width,
        h: fSize * 1.2
      };
    }
    if (['rect', 'ellipse'].includes(item.tool)) {
      return {
        x: Math.min(item.x, item.x + item.w),
        y: Math.min(item.y, item.y + item.h),
        w: Math.abs(item.w),
        h: Math.abs(item.h)
      };
    }
    if (['line', 'arrow'].includes(item.tool)) {
      return {
        x: Math.min(item.x1, item.x2),
        y: Math.min(item.y1, item.y2),
        w: Math.abs(item.x2 - item.x1),
        h: Math.abs(item.y2 - item.y1)
      };
    }
    if (item.points && item.points.length) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of item.points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    return null;
  }

  function getHandleHit(x, y, item) {
    if (!canvasEl || !item) return null;
    const ctx = canvasEl.getContext('2d');
    const bounds = getItemBounds(ctx, item);
    if (!bounds) return null;
    const handles = getCornerHandles(bounds, 8);
    const radius = 14;

    for (const [pos, h] of Object.entries(handles)) {
      if (Math.hypot(h.x - x, h.y - y) <= radius) {
        return pos;
      }
    }
    return null;
  }

  function hitTest(x, y) {
    if (!canvasEl) return null;
    const ctx = canvasEl.getContext('2d');
    for (let i = history.length - 1; i >= 0; i--) {
      const item = history[i];
      const bounds = getItemBounds(ctx, item);
      if (bounds) {
        const pad = 12;
        if (x >= bounds.x - pad && x <= bounds.x + bounds.w + pad &&
            y >= bounds.y - pad && y <= bounds.y + bounds.h + pad) {
          return item;
        }
      }
    }
    return null;
  }

  function drawArrow(ctx, x1, y1, x2, y2, size) {
    const headlen = Math.max(14, size * 3);
    const angle = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headlen * Math.cos(angle - Math.PI / 6), y2 - headlen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(x2 - headlen * Math.cos(angle + Math.PI / 6), y2 - headlen * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  }

  function getCoords(e) {
    const rect = canvasEl.getBoundingClientRect();
    const scaleX = canvasEl.width / rect.width;
    const scaleY = canvasEl.height / rect.height;

    // Relative to canvas display box (for precise CSS element positioning)
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    // In natural canvas coordinates
    const canvasX = screenX * scaleX;
    const canvasY = screenY * scaleY;

    return { screenX, screenY, canvasX, canvasY };
  }

  function onPointerDown(e) {
    if (activeTextObj) {
      commitActiveText();
    }

    const { screenX, screenY, canvasX, canvasY } = getCoords(e);
    startX = canvasX;
    startY = canvasY;

    // 1. SELECT / MOVE / RESIZE MODE
    if (currentTool === 'select') {
      objectsSidebarOpen = true;

      // Check if clicked on a corner handle of the selected object
      if (selectedItem) {
        const handle = getHandleHit(canvasX, canvasY, selectedItem);
        if (handle) {
          isResizing = true;
          activeHandle = handle;
          const ctx = canvasEl.getContext('2d');
          resizeOrigin = {
            startX: canvasX,
            startY: canvasY,
            bounds: { ...getItemBounds(ctx, selectedItem) },
            item: { ...selectedItem }
          };
          return;
        }
      }

      // Check if clicked inside an object
      const hit = hitTest(canvasX, canvasY);
      if (hit) {
        selectedObjectId = hit.id;
        isDraggingSelected = true;
        dragOffset = { x: canvasX, y: canvasY };
        redrawAll();
      } else {
        selectedObjectId = null;
        redrawAll();
      }
      return;
    }

    // 2. TEXT TOOL
    if (currentTool === 'text') {
      const hit = hitTest(canvasX, canvasY);
      if (hit && hit.tool === 'text') {
        selectedObjectId = hit.id;
        activeTextObj = {
          id: hit.id,
          canvasX: hit.x,
          canvasY: hit.y,
          screenX,
          screenY,
          color: hit.color,
          fontSize: hit.fontSize || textFontSize,
          fontFamily: hit.fontFamily || textFontFamily
        };
        textInputVal = hit.text;
        redrawAll();
        return;
      }

      // New text input positioned precisely at the mouse click location
      activeTextObj = {
        id: crypto.randomUUID(),
        canvasX,
        canvasY,
        screenX,
        screenY,
        color: currentColor,
        fontSize: textFontSize,
        fontFamily: textFontFamily
      };
      textInputVal = '';
      return;
    }

    // 3. DRAWING TOOLS
    selectedObjectId = null;
    isDrawing = true;

    if (currentTool === 'pen' || currentTool === 'marker') {
      const newItem = {
        id: crypto.randomUUID(),
        tool: currentTool,
        color: currentColor,
        size: currentSize,
        points: [{ x: canvasX, y: canvasY }]
      };
      history = [...history, newItem];
      redoStack = [];
    } else if (currentTool === 'eraser') {
      eraseAt(canvasX, canvasY);
    }
  }

  function onPointerMove(e) {
    const { canvasX, canvasY } = getCoords(e);

    // Resizing selected object
    if (isResizing && selectedItem && resizeOrigin) {
      const b = resizeOrigin.bounds;
      let x1 = b.x;
      let y1 = b.y;
      let x2 = b.x + b.w;
      let y2 = b.y + b.h;

      if (activeHandle === 'se') {
        x1 = b.x;
        y1 = b.y;
        x2 = canvasX;
        y2 = canvasY;
      } else if (activeHandle === 'nw') {
        x1 = canvasX;
        y1 = canvasY;
        x2 = b.x + b.w;
        y2 = b.y + b.h;
      } else if (activeHandle === 'ne') {
        x1 = b.x;
        y1 = canvasY;
        x2 = canvasX;
        y2 = b.y + b.h;
      } else if (activeHandle === 'sw') {
        x1 = canvasX;
        y1 = b.y;
        x2 = b.x + b.w;
        y2 = canvasY;
      }

      const newLeft = Math.min(x1, x2);
      const newTop = Math.min(y1, y2);
      const newWidth = Math.max(10, Math.abs(x2 - x1));
      const newHeight = Math.max(10, Math.abs(y2 - y1));

      if (['rect', 'ellipse'].includes(selectedItem.tool)) {
        selectedItem.x = newLeft;
        selectedItem.y = newTop;
        selectedItem.w = newWidth;
        selectedItem.h = newHeight;
      } else if (['line', 'arrow'].includes(selectedItem.tool)) {
        const d1 = Math.hypot(resizeOrigin.startX - resizeOrigin.item.x1, resizeOrigin.startY - resizeOrigin.item.y1);
        const d2 = Math.hypot(resizeOrigin.startX - resizeOrigin.item.x2, resizeOrigin.startY - resizeOrigin.item.y2);
        if (d1 < d2) {
          selectedItem.x1 = canvasX;
          selectedItem.y1 = canvasY;
        } else {
          selectedItem.x2 = canvasX;
          selectedItem.y2 = canvasY;
        }
      } else if (selectedItem.tool === 'text') {
        const scale = Math.max(0.3, newHeight / Math.max(10, b.h));
        const initSize = resizeOrigin.item.fontSize || 28;
        selectedItem.fontSize = Math.max(12, Math.min(120, Math.round(initSize * scale)));
        selectedItem.x = newLeft;
        selectedItem.y = newTop + selectedItem.fontSize;
      } else if (selectedItem.points) {
        let anchorX = b.x;
        let anchorY = b.y;
        if (activeHandle === 'nw') {
          anchorX = b.x + b.w;
          anchorY = b.y + b.h;
        } else if (activeHandle === 'ne') {
          anchorX = b.x;
          anchorY = b.y + b.h;
        } else if (activeHandle === 'sw') {
          anchorX = b.x + b.w;
          anchorY = b.y;
        }
        const scaleX = newWidth / Math.max(10, b.w);
        const scaleY = newHeight / Math.max(10, b.h);
        selectedItem.points = resizeOrigin.item.points.map((p) => ({
          x: anchorX + (p.x - anchorX) * scaleX,
          y: anchorY + (p.y - anchorY) * scaleY
        }));
      }

      // Trigger Svelte reactivity on history
      history = [...history];
      redrawAll();
      return;
    }

    // Moving selected object
    if (isDraggingSelected && selectedObjectId) {
      const dx = canvasX - dragOffset.x;
      const dy = canvasY - dragOffset.y;
      dragOffset = { x: canvasX, y: canvasY };

      const item = history.find((it) => it.id === selectedObjectId);
      if (item) {
        if (item.points) {
          item.points = item.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
        } else if (item.x != null && item.y != null) {
          item.x += dx;
          item.y += dy;
        } else if (item.x1 != null && item.y1 != null) {
          item.x1 += dx;
          item.y1 += dy;
          item.x2 += dx;
          item.y2 += dy;
        }
        redrawAll();
      }
      return;
    }

    if (!isDrawing) return;

    if (currentTool === 'pen' || currentTool === 'marker') {
      const currentStroke = history[history.length - 1];
      if (currentStroke && currentStroke.points) {
        currentStroke.points.push({ x: canvasX, y: canvasY });
        redrawAll();
      }
    } else if (currentTool === 'eraser') {
      eraseAt(canvasX, canvasY);
    } else if (['rect', 'ellipse', 'line', 'arrow'].includes(currentTool)) {
      redrawAll();
      const ctx = canvasEl.getContext('2d');
      ctx.save();
      ctx.lineWidth = currentSize;
      ctx.strokeStyle = currentColor;
      ctx.fillStyle = currentColor;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (currentTool === 'rect') {
        ctx.strokeRect(startX, startY, canvasX - startX, canvasY - startY);
      } else if (currentTool === 'ellipse') {
        ctx.beginPath();
        const rx = Math.abs(canvasX - startX) / 2;
        const ry = Math.abs(canvasY - startY) / 2;
        ctx.ellipse(startX + (canvasX - startX) / 2, startY + (canvasY - startY) / 2, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (currentTool === 'line') {
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(canvasX, canvasY);
        ctx.stroke();
      } else if (currentTool === 'arrow') {
        drawArrow(ctx, startX, startY, canvasX, canvasY, currentSize);
      }
      ctx.restore();
    }
  }

  function onPointerUp(e) {
    if (isResizing) {
      isResizing = false;
      activeHandle = null;
      resizeOrigin = null;
      return;
    }

    if (isDraggingSelected) {
      isDraggingSelected = false;
      return;
    }

    if (!isDrawing) return;
    isDrawing = false;

    const { canvasX, canvasY } = getCoords(e);

    if (['rect', 'ellipse'].includes(currentTool)) {
      const newItem = {
        id: crypto.randomUUID(),
        tool: currentTool,
        color: currentColor,
        size: currentSize,
        x: startX,
        y: startY,
        w: canvasX - startX,
        h: canvasY - startY
      };
      history = [...history, newItem];
      selectedObjectId = newItem.id;
      redoStack = [];
      redrawAll();
    } else if (['line', 'arrow'].includes(currentTool)) {
      const newItem = {
        id: crypto.randomUUID(),
        tool: currentTool,
        color: currentColor,
        size: currentSize,
        x1: startX,
        y1: startY,
        x2: canvasX,
        y2: canvasY
      };
      history = [...history, newItem];
      selectedObjectId = newItem.id;
      redoStack = [];
      redrawAll();
    }
  }

  function eraseAt(x, y) {
    const threshold = 30;
    history = history.filter((item) => {
      if (item.points) {
        return !item.points.some((p) => Math.hypot(p.x - x, p.y - y) < threshold);
      }
      if (item.x != null && item.y != null) {
        return !(x >= item.x - threshold && x <= item.x + (item.w || 50) + threshold &&
                 y >= item.y - threshold && y <= item.y + (item.h || 50) + threshold);
      }
      return true;
    });
    redrawAll();
  }

  function commitActiveText() {
    if (activeTextObj && textInputVal.trim()) {
      const existingIdx = history.findIndex((it) => it.id === activeTextObj.id);
      const textItem = {
        id: activeTextObj.id,
        tool: 'text',
        text: textInputVal.trim(),
        x: activeTextObj.canvasX,
        y: activeTextObj.canvasY,
        color: activeTextObj.color,
        fontSize: activeTextObj.fontSize || textFontSize,
        fontFamily: activeTextObj.fontFamily || textFontFamily
      };

      if (existingIdx >= 0) {
        history[existingIdx] = textItem;
      } else {
        history = [...history, textItem];
      }
      selectedObjectId = textItem.id;
      redoStack = [];
      redrawAll();
    }
    activeTextObj = null;
    textInputVal = '';
  }

  function updateSelectedColor(color) {
    currentColor = color;
    if (selectedItem) {
      selectedItem.color = color;
      redrawAll();
    }
  }

  function updateSelectedSize(size) {
    currentSize = size;
    if (selectedItem) {
      selectedItem.size = size;
      redrawAll();
    }
  }

  function changeFontSize(delta) {
    textFontSize = Math.max(12, Math.min(120, textFontSize + delta));
    if (selectedItem && selectedItem.tool === 'text') {
      selectedItem.fontSize = textFontSize;
      redrawAll();
    }
    if (activeTextObj) {
      activeTextObj.fontSize = textFontSize;
    }
  }

  function updateFontFamily(fontId) {
    textFontFamily = fontId;
    if (selectedItem && selectedItem.tool === 'text') {
      selectedItem.fontFamily = fontId;
      redrawAll();
    }
    if (activeTextObj) {
      activeTextObj.fontFamily = fontId;
    }
  }

  // Object actions: Move step, Resize step, Duplicate, Delete, Layer order
  function nudgeObject(axis, delta) {
    if (!selectedItem) return;
    if (selectedItem.points) {
      selectedItem.points = selectedItem.points.map((p) => ({
        x: axis === 'x' ? p.x + delta : p.x,
        y: axis === 'y' ? p.y + delta : p.y
      }));
    } else if (selectedItem.x != null && selectedItem.y != null) {
      if (axis === 'x') selectedItem.x += delta;
      else selectedItem.y += delta;
    } else if (selectedItem.x1 != null) {
      if (axis === 'x') { selectedItem.x1 += delta; selectedItem.x2 += delta; }
      else { selectedItem.y1 += delta; selectedItem.y2 += delta; }
    }
    redrawAll();
  }

  function stepObjectDim(dim, delta) {
    if (!selectedItem) return;
    if (selectedItem.w != null && selectedItem.h != null) {
      if (dim === 'w') selectedItem.w = Math.max(10, selectedItem.w + delta);
      else selectedItem.h = Math.max(10, selectedItem.h + delta);
    } else if (selectedItem.tool === 'text') {
      selectedItem.fontSize = Math.max(12, (selectedItem.fontSize || 28) + delta);
    } else if (selectedItem.size != null) {
      selectedItem.size = Math.max(1, selectedItem.size + (delta > 0 ? 1 : -1));
    }
    redrawAll();
  }

  function duplicateObject(id) {
    const item = history.find((it) => it.id === id);
    if (!item) return;
    const cloned = JSON.parse(JSON.stringify(item));
    cloned.id = crypto.randomUUID();
    if (cloned.x != null) { cloned.x += 20; cloned.y += 20; }
    if (cloned.x1 != null) { cloned.x1 += 20; cloned.y1 += 20; cloned.x2 += 20; cloned.y2 += 20; }
    if (cloned.points) cloned.points = cloned.points.map((p) => ({ x: p.x + 20, y: p.y + 20 }));
    history = [...history, cloned];
    selectedObjectId = cloned.id;
    redrawAll();
  }

  function bringForward(id) {
    const idx = history.findIndex((it) => it.id === id);
    if (idx < 0 || idx >= history.length - 1) return;
    const next = [...history];
    const [item] = next.splice(idx, 1);
    next.splice(idx + 1, 0, item);
    history = next;
    redrawAll();
  }

  function sendBackward(id) {
    const idx = history.findIndex((it) => it.id === id);
    if (idx <= 0) return;
    const next = [...history];
    const [item] = next.splice(idx, 1);
    next.splice(idx - 1, 0, item);
    history = next;
    redrawAll();
  }

  function deleteSelected() {
    if (selectedObjectId) {
      history = history.filter((it) => it.id !== selectedObjectId);
      selectedObjectId = null;
      redrawAll();
    }
  }

  function undo() {
    if (history.length > 0) {
      const item = history[history.length - 1];
      history = history.slice(0, -1);
      redoStack = [...redoStack, item];
      selectedObjectId = null;
      redrawAll();
    }
  }

  function redo() {
    if (redoStack.length > 0) {
      const item = redoStack[redoStack.length - 1];
      redoStack = redoStack.slice(0, -1);
      history = [...history, item];
      selectedObjectId = item.id;
      redrawAll();
    }
  }

  function onKeydown(e) {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedObjectId && !activeTextObj) {
        e.preventDefault();
        deleteSelected();
      }
    } else if (e.key === 'Escape') {
      if (activeTextObj) {
        activeTextObj = null;
      } else {
        onCancel();
      }
    }
  }

  function saveAnnotatedImage() {
    commitActiveText();
    selectedObjectId = null;
    redrawAll();
    if (!canvasEl) return;
    const finalDataUrl = canvasEl.toDataURL('image/png');
    onSave(finalDataUrl);
  }

  function getObjectLabel(item) {
    if (item.tool === 'text') return `نص: "${(item.text || '').slice(0, 16)}"`;
    if (item.tool === 'rect') return 'مستطيل (Rectangle)';
    if (item.tool === 'ellipse') return 'دائرة / شكل بيضاوي';
    if (item.tool === 'arrow') return 'سهم (Arrow)';
    if (item.tool === 'line') return 'خط مستقيم (Line)';
    if (item.tool === 'marker') return 'تظليل (Highlighter)';
    if (item.tool === 'pen') return 'رسم يدوي (Pen)';
    return 'عنصر';
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="annotation-overlay" role="dialog" aria-modal="true" tabindex="-1">

  <!-- Top Annotation Bar -->
  <header class="anno-bar">
    <!-- Primary Tools -->
    <div class="anno-group tools">
      <button
        class="tool-btn {currentTool === 'select' ? 'active' : ''}"
        onclick={() => { currentTool = 'select'; objectsSidebarOpen = true; }}
        title="تحديد وتحريك العناصر (Select & Move)"
      >
        <Icon name="pointer" size={16} />
      </button>

      <button
        class="tool-btn {currentTool === 'pen' ? 'active' : ''}"
        onclick={() => (currentTool = 'pen')}
        title={tr('tool.pen')}
      >
        <Icon name="pen" size={16} />
      </button>

      <button
        class="tool-btn {currentTool === 'marker' ? 'active' : ''}"
        onclick={() => (currentTool = 'marker')}
        title={tr('tool.marker')}
      >
        <Icon name="marker" size={16} />
      </button>

      <button
        class="tool-btn {currentTool === 'text' ? 'active' : ''}"
        onclick={() => (currentTool = 'text')}
        title={tr('tool.text')}
      >
        <Icon name="text" size={16} />
      </button>

      <button
        class="tool-btn {currentTool === 'rect' ? 'active' : ''}"
        onclick={() => (currentTool = 'rect')}
        title={tr('shape.rectangle')}
      >
        <Icon name="shape" size={16} />
      </button>

      <button
        class="tool-btn {currentTool === 'ellipse' ? 'active' : ''}"
        onclick={() => (currentTool = 'ellipse')}
        title={tr('shape.ellipse')}
      >
        <Icon name="shape" size={16} />
      </button>

      <button
        class="tool-btn {currentTool === 'arrow' ? 'active' : ''}"
        onclick={() => (currentTool = 'arrow')}
        title={tr('shape.arrow')}
      >
        <Icon name="chevron-right" size={16} />
      </button>

      <button
        class="tool-btn {currentTool === 'line' ? 'active' : ''}"
        onclick={() => (currentTool = 'line')}
        title="Line"
      >
        <Icon name="pencil" size={16} />
      </button>

      <button
        class="tool-btn {currentTool === 'eraser' ? 'active' : ''}"
        onclick={() => (currentTool = 'eraser')}
        title={tr('tool.eraser')}
      >
        <Icon name="eraser" size={16} />
      </button>
    </div>

    <!-- Font Family Selector (Arabic & Latin Fonts) -->
    {#if currentTool === 'text' || (selectedItem && selectedItem.tool === 'text')}
      <div class="anno-group font-picker">
        <Icon name="file-text" size={14} />
        <select
          value={selectedItem?.fontFamily || textFontFamily}
          onchange={(e) => updateFontFamily(e.currentTarget.value)}
          class="font-select"
          title={tr('annotation.fontFamily')}
        >
          {#each ANNOTATION_FONTS as f}
            <option value={f.id}>{f.name}</option>
          {/each}
        </select>
      </div>

      <!-- Font Size Stepper -->
      <div class="anno-group font-stepper">
        <button class="step-btn" onclick={() => changeFontSize(-3)} title="Decrease font size">-</button>
        <span class="step-val">{selectedItem?.fontSize || textFontSize}px</span>
        <button class="step-btn" onclick={() => changeFontSize(3)} title="Increase font size">+</button>
      </div>
    {/if}

    <!-- Stroke Sizes (for drawing and shapes) -->
    <div class="anno-group sizes">
      {#each SIZES as sz}
        <button
          class="size-dot-btn {currentSize === sz ? 'active' : ''}"
          onclick={() => updateSelectedSize(sz)}
          title={`Size ${sz}`}
        >
          <span class="size-dot" style="width:{sz * 1.5 + 4}px; height:{sz * 1.5 + 4}px;"></span>
        </button>
      {/each}
    </div>

    <!-- Color Palette -->
    <div class="anno-group colors">
      {#each COLORS as clr}
        <button
          class="color-btn {currentColor === clr ? 'active' : ''}"
          style="background:{clr};"
          onclick={() => updateSelectedColor(clr)}
          title={clr}
        ></button>
      {/each}
    </div>

    <!-- Objects Sidebar Toggle Button -->
    <button
      class="objects-toggle-btn {objectsSidebarOpen ? 'active' : ''}"
      onclick={() => (objectsSidebarOpen = !objectsSidebarOpen)}
      title={tr('annotation.objectsList')}
    >
      <Icon name="columns" size={15} />
      <span>{tr('annotation.objectsList')}</span>
      {#if history.length}<span class="obj-badge">{history.length}</span>{/if}
    </button>

    <!-- Undo / Redo / Delete Object -->
    <div class="anno-group history">
      <button class="tool-btn" onclick={undo} disabled={history.length === 0} title={tr('reader.undo')}>
        <Icon name="undo" size={15} />
      </button>
      <button class="tool-btn" onclick={redo} disabled={redoStack.length === 0} title={tr('reader.redo')}>
        <Icon name="redo" size={15} />
      </button>
      {#if selectedObjectId}
        <button class="tool-btn danger" onclick={deleteSelected} title="Delete Object">
          <Icon name="trash" size={15} />
        </button>
      {/if}
    </div>

    <!-- Action Buttons -->
    <div class="anno-group actions" style="margin-left:auto;">
      <span class="timecode-badge mono text-xs">{timecode}</span>
      <button class="discard-btn" onclick={onCancel} title={tr('video.discard')}>
        <Icon name="x" size={14} />
        <span>{tr('video.discard')}</span>
      </button>
      <button class="primary save-btn" onclick={saveAnnotatedImage} title={tr('video.saveAnnotated')}>
        <Icon name="check" size={14} />
        <span>{tr('video.saveAnnotated')}</span>
      </button>
    </div>
  </header>

  <!-- Main Body: Canvas Stage + Objects & Layers Sidebar -->
  <div class="anno-body">

    <!-- Interactive Canvas Stage -->
    <div class="anno-stage">
      <div class="canvas-container" bind:this={containerEl}>
        <canvas
          bind:this={canvasEl}
          class="anno-canvas {currentTool}"
          onpointerdown={onPointerDown}
          onpointermove={onPointerMove}
          onpointerup={onPointerUp}
        ></canvas>

        <!-- Accurate In-Place Text Input Box: appears right at the click coordinates -->
        {#if activeTextObj}
          <div class="active-text-input-wrap" style="left:{activeTextObj.screenX}px; top:{activeTextObj.screenY}px;">
            <input
              type="text"
              bind:value={textInputVal}
              placeholder="اكتب ملاحظة..."
              onkeydown={(e) => { if (e.key === 'Enter') commitActiveText(); }}
              class="in-place-text-input"
              style="color:{activeTextObj.color}; font-size:{Math.max(14, activeTextObj.fontSize * 0.7)}px; font-family:{activeTextObj.fontFamily || textFontFamily};"
            />
            <button class="text-ok-btn" onclick={commitActiveText} title="تطبيق">
              <Icon name="check" size={13} />
            </button>
          </div>
        {/if}
      </div>
    </div>

    <!-- Objects & Layers Sidebar -->
    {#if objectsSidebarOpen}
      <aside class="objects-sidebar" dir="rtl">
        <div class="sidebar-header">
          <span class="sidebar-title">{tr('annotation.objectsList')} ({history.length})</span>
          <button class="icon-btn" onclick={() => (objectsSidebarOpen = false)} title={tr('common.close')}>
            <Icon name="x" size={14} />
          </button>
        </div>

        <!-- Selected Object Properties Inspector -->
        {#if selectedItem}
          <div class="inspector-card">
            <div class="inspector-title">
              <span>{getObjectLabel(selectedItem)}</span>
              <div class="hstack" style="gap:4px">
                <button class="icon-btn" onclick={() => duplicateObject(selectedItem.id)} title={tr('annotation.duplicate')}>
                  <Icon name="plus" size={13} />
                </button>
                <button class="icon-btn" onclick={() => bringForward(selectedItem.id)} title={tr('annotation.bringForward')}>
                  <Icon name="chevron-up" size={13} />
                </button>
                <button class="icon-btn" onclick={() => sendBackward(selectedItem.id)} title={tr('annotation.sendBackward')}>
                  <Icon name="chevron-down" size={13} />
                </button>
                <button class="icon-btn danger" onclick={deleteSelected} title={tr('common.delete')}>
                  <Icon name="trash" size={13} />
                </button>
              </div>
            </div>

            <!-- Position Controls X/Y -->
            <div class="prop-row">
              <span class="prop-label">{tr('annotation.posX')}</span>
              <div class="stepper-wrap">
                <button onclick={() => nudgeObject('x', -5)}>-</button>
                <span class="mono text-xs">{Math.round(selectedItem.x || selectedItem.x1 || 0)}</span>
                <button onclick={() => nudgeObject('x', 5)}>+</button>
              </div>
            </div>

            <div class="prop-row">
              <span class="prop-label">{tr('annotation.posY')}</span>
              <div class="stepper-wrap">
                <button onclick={() => nudgeObject('y', -5)}>-</button>
                <span class="mono text-xs">{Math.round(selectedItem.y || selectedItem.y1 || 0)}</span>
                <button onclick={() => nudgeObject('y', 5)}>+</button>
              </div>
            </div>

            <!-- Dimensions W/H -->
            {#if selectedItem.w != null && selectedItem.h != null}
              <div class="prop-row">
                <span class="prop-label">{tr('annotation.width')}</span>
                <div class="stepper-wrap">
                  <button onclick={() => stepObjectDim('w', -10)}>-</button>
                  <span class="mono text-xs">{Math.round(Math.abs(selectedItem.w))}</span>
                  <button onclick={() => stepObjectDim('w', 10)}>+</button>
                </div>
              </div>
              <div class="prop-row">
                <span class="prop-label">{tr('annotation.height')}</span>
                <div class="stepper-wrap">
                  <button onclick={() => stepObjectDim('h', -10)}>-</button>
                  <span class="mono text-xs">{Math.round(Math.abs(selectedItem.h))}</span>
                  <button onclick={() => stepObjectDim('h', 10)}>+</button>
                </div>
              </div>
            {/if}

            <!-- Text Specific Properties -->
            {#if selectedItem.tool === 'text'}
              <div class="prop-row">
                <span class="prop-label">{tr('annotation.fontFamily')}</span>
                <select
                  value={selectedItem.fontFamily || textFontFamily}
                  onchange={(e) => updateFontFamily(e.currentTarget.value)}
                  class="prop-select"
                >
                  {#each ANNOTATION_FONTS as f}
                    <option value={f.id}>{f.name}</option>
                  {/each}
                </select>
              </div>

              <div class="prop-row">
                <span class="prop-label">حجم الخط</span>
                <div class="stepper-wrap">
                  <button onclick={() => changeFontSize(-3)}>-</button>
                  <span class="mono text-xs">{selectedItem.fontSize || 28}px</span>
                  <button onclick={() => changeFontSize(3)}>+</button>
                </div>
              </div>

              <div class="prop-col" style="margin-top:8px">
                <input
                  type="text"
                  bind:value={selectedItem.text}
                  oninput={redrawAll}
                  class="edit-text-input"
                  placeholder="محتوى النص..."
                />
              </div>
            {/if}

            <!-- Object Color Picker -->
            <div class="prop-row" style="margin-top:8px">
              <span class="prop-label">اللون</span>
              <div class="hstack" style="gap:4px">
                {#each COLORS as clr}
                  <button
                    class="color-dot {selectedItem.color === clr ? 'active' : ''}"
                    style="background:{clr}"
                    onclick={() => updateSelectedColor(clr)}
                  ></button>
                {/each}
              </div>
            </div>
          </div>
        {/if}

        <!-- List of all objects -->
        <div class="objects-list">
          {#if history.length === 0}
            <div class="empty-hint muted">{tr('annotation.noObjects')}</div>
          {:else}
            {#each history as item, idx (item.id)}
              <div
                class="object-row {item.id === selectedObjectId ? 'selected' : ''}"
                onclick={() => { selectedObjectId = item.id; redrawAll(); }}
              >
                <span class="obj-dot" style="background:{item.color || '#ef4444'}"></span>
                <span class="obj-name grow">{getObjectLabel(item)}</span>
                <button
                  class="icon-btn-sm"
                  onclick={(e) => { e.stopPropagation(); duplicateObject(item.id); }}
                  title={tr('annotation.duplicate')}
                >
                  <Icon name="plus" size={11} />
                </button>
                <button
                  class="icon-btn-sm danger"
                  onclick={(e) => {
                    e.stopPropagation();
                    history = history.filter((it) => it.id !== item.id);
                    if (selectedObjectId === item.id) selectedObjectId = null;
                    redrawAll();
                  }}
                  title={tr('common.delete')}
                >
                  <Icon name="trash" size={11} />
                </button>
              </div>
            {/each}
          {/if}
        </div>
      </aside>
    {/if}

  </div>

</div>

<style>
  .annotation-overlay {
    position: absolute;
    inset: 0;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    background: rgba(10, 12, 18, 0.96);
    backdrop-filter: blur(8px);
    overflow: hidden;
  }

  .anno-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
    z-index: 10;
  }

  .anno-group {
    display: flex;
    align-items: center;
    gap: 4px;
    background: var(--surface-2, rgba(0, 0, 0, 0.04));
    border: 1px solid var(--border);
    padding: 3px 6px;
    border-radius: 6px;
  }

  .tool-btn {
    background: transparent;
    border: none;
    border-radius: 5px;
    padding: 5px 7px;
    cursor: pointer;
    color: var(--text);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s, color 0.15s;
  }
  .tool-btn:hover {
    background: var(--surface-hover, rgba(0, 0, 0, 0.08));
  }
  .tool-btn.active {
    background: var(--accent);
    color: #ffffff;
  }
  .tool-btn.danger:hover {
    background: var(--danger, #ef4444);
    color: #fff;
  }

  .font-select {
    padding: 3px 6px;
    border: none;
    background: transparent;
    font-size: 12px;
    color: var(--text);
    outline: none;
    cursor: pointer;
  }

  .font-stepper {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
  }
  .step-btn {
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
    font-size: 13px;
    font-weight: bold;
    padding: 0;
  }
  .step-btn:hover { background: var(--surface-2); }
  .step-val {
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    min-width: 32px;
    text-align: center;
  }

  .size-dot-btn {
    background: transparent;
    border: none;
    border-radius: 4px;
    padding: 4px 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .size-dot-btn.active {
    background: rgba(0, 0, 0, 0.12);
  }
  .size-dot {
    border-radius: 50%;
    background: currentColor;
    display: inline-block;
  }

  .color-btn {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    padding: 0;
    transition: transform 0.15s, border-color 0.15s;
  }
  .color-btn:hover { transform: scale(1.15); }
  .color-btn.active {
    border-color: #ffffff;
    box-shadow: 0 0 0 2px var(--accent);
  }

  .objects-toggle-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--surface-2, rgba(0, 0, 0, 0.04));
    color: var(--text);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
  }
  .objects-toggle-btn.active {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
  }
  .obj-badge {
    background: rgba(255, 255, 255, 0.25);
    border-radius: 99px;
    padding: 1px 6px;
    font-size: 10px;
    font-weight: bold;
  }

  .timecode-badge {
    color: var(--muted);
    font-size: 12px;
    margin-right: 6px;
  }

  .discard-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 5px 10px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text);
    cursor: pointer;
    font-size: 12px;
  }
  .save-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 5px 14px;
    border-radius: 6px;
    background: var(--accent);
    color: #ffffff;
    border: none;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
  }

  /* Body Layout: Stage + Objects Sidebar */
  .anno-body {
    flex: 1;
    display: flex;
    overflow: hidden;
    position: relative;
    direction: ltr; /* Stage left, sidebar right */
  }

  .anno-stage {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: auto;
    padding: 20px;
  }

  .canvas-container {
    position: relative;
    display: inline-block;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    border-radius: 4px;
    overflow: visible;
  }

  .anno-canvas {
    display: block;
    max-width: 85vw;
    max-height: 80vh;
    min-width: min(720px, 90vw);
    width: auto;
    height: auto;
    cursor: crosshair;
    user-select: none;
    touch-action: none;
  }
  .anno-canvas.select { cursor: default; }
  .anno-canvas.text { cursor: text; }
  .anno-canvas.eraser { cursor: cell; }

  /* In-place Text Input */
  .active-text-input-wrap {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 4px;
    background: rgba(15, 23, 42, 0.95);
    border: 1.5px solid var(--accent);
    border-radius: 6px;
    padding: 4px 6px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    z-index: 100;
    transform: translate(0, -50%);
  }
  .in-place-text-input {
    background: transparent;
    border: none;
    outline: none;
    font-weight: bold;
    min-width: 140px;
  }
  .text-ok-btn {
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 4px;
    padding: 3px 6px;
    cursor: pointer;
  }

  /* Objects Sidebar */
  .objects-sidebar {
    width: 290px;
    flex: none;
    background: var(--surface);
    border-left: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    z-index: 20;
    box-shadow: -4px 0 16px rgba(0, 0, 0, 0.2);
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    background: var(--surface-2, rgba(0, 0, 0, 0.04));
    border-bottom: 1px solid var(--border);
  }
  .sidebar-title {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text);
  }

  .inspector-card {
    padding: 12px 14px;
    background: var(--surface-soft, rgba(0, 0, 0, 0.02));
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .inspector-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
    font-weight: 600;
    color: var(--accent);
    margin-bottom: 4px;
  }

  .prop-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11.5px;
  }
  .prop-label { color: var(--muted); }
  .stepper-wrap {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 2px 4px;
    background: var(--surface);
  }
  .stepper-wrap button {
    border: none;
    background: transparent;
    cursor: pointer;
    font-weight: bold;
    padding: 0 4px;
    color: var(--text);
  }
  .stepper-wrap button:hover { color: var(--accent); }
  .prop-select {
    padding: 2px 6px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--surface);
    color: var(--text);
    font-size: 11px;
    max-width: 140px;
  }
  .edit-text-input {
    width: 100%;
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--surface);
    color: var(--text);
    font-size: 12px;
  }

  .color-dot {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 1.5px solid transparent;
    cursor: pointer;
    padding: 0;
  }
  .color-dot.active { border-color: #fff; box-shadow: 0 0 0 1px var(--accent); }

  .objects-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .empty-hint {
    padding: 24px 12px;
    text-align: center;
    font-size: 12px;
  }

  .object-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border-radius: 6px;
    border: 1px solid transparent;
    background: var(--surface-2, rgba(0, 0, 0, 0.03));
    cursor: pointer;
    font-size: 11.5px;
    transition: background 0.15s, border-color 0.15s;
  }
  .object-row:hover { background: var(--surface-hover, rgba(0, 0, 0, 0.07)); }
  .object-row.selected {
    background: var(--accent-soft, rgba(59, 130, 246, 0.15));
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 500;
  }
  .obj-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex: none;
  }
  .icon-btn-sm {
    border: none;
    background: transparent;
    border-radius: 4px;
    padding: 2px 4px;
    cursor: pointer;
    color: var(--muted);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .icon-btn-sm:hover { color: var(--text); background: rgba(0, 0, 0, 0.08); }
  .icon-btn-sm.danger:hover { color: var(--danger, #ef4444); }
</style>
