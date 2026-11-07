<script>
  // One page of the reader, including its own annotation layers. Keeping the
  // canvases per page is what makes a continuous strip and a two-page spread
  // possible: every page can be annotated without a single "active canvas"
  // pretending to be the whole document.
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { renderPageToCanvas, renderTextLayer } from '../lib/pdf.js';
  import { createTransform, displaySize } from '../lib/geometry.js';
  import { renderAnnotations } from '../lib/annotations.js';
  import { ANNOTATION_FONTS, DEFAULT_ANNOTATION_FONT } from '../lib/fonts.js';
  import { t as tr } from '../lib/lang.svelte.js';

  let {
    pdfDoc,
    pageNumber,
    totalPages = 0,
    scale = 1,
    rotation = 0,
    baseWidth = 595,
    baseHeight = 842,
    annotations = [],
    viewFilter = 'all',
    pageRender = 'pdf',
    gridStyle = '',
    bookmarks = [],
    activeBookmark = '',
    active = false,
    interactive = true,
    lazy = false,
    scrollRoot = null,
    tool = 'marker',
    color = '#F4D03F',
    opacity = 1,
    sizePx = 5,
    draft = null,
    captureRect = null,
    textRequest = null,
    redPen = [],
    handCursor = '',
    panning = false,
    onpointer = () => {},
    ontextdone = () => {},
    onsize = () => {},
    onready = () => {}
  } = $props();

  let wrap = $state();
  let pdfCanvas = $state();
  let textLayerEl = $state();
  let markerCanvas = $state();
  let redpenCanvas = $state();
  let cursorCanvas = $state();
  let annCanvas = $state();

  let ready = $state(false);
  let hasText = $state(false);
  let inView = $state(false);
  let dpr = 1;
  let rendering = false;
  let queued = false;
  let renderSeq = 0;
  let cursorPoint = null;
  let currentRenderTask = null;

  let editor = $state(null);
  let editorRequestKey = null;
  let editorSeq = 0;

  const display = $derived(displaySize(
    Math.max(1, Number(baseWidth) || 1),
    Math.max(1, Number(baseHeight) || 1),
    Number(scale) || 1,
    Number(rotation) || 0
  ));
  const transform = $derived(createTransform({
    pageWidth: Math.max(1, Number(baseWidth) || 1),
    pageHeight: Math.max(1, Number(baseHeight) || 1),
    scale: Number(scale) || 1,
    rotation: Number(rotation) || 0
  }));
  const pageDraft = $derived(draft && draft.page === pageNumber ? draft : null);
  const pageCapture = $derived(captureRect && captureRect.page === pageNumber ? captureRect : null);
  const pageBookmarks = $derived((bookmarks || []).filter((b) => b.page === pageNumber && typeof b.u === 'number' && typeof b.v === 'number'));
  const gridImage = $derived(
    gridStyle === 'lines'
      ? 'linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)'
      : gridStyle === 'dotsWide'
        ? 'radial-gradient(circle, var(--border) 1.7px, transparent 1.8px)'
        : gridStyle === 'dotsFine'
          ? 'radial-gradient(circle, var(--border) 1px, transparent 1.1px)'
          : ''
  );
  const gridSize = $derived(
    gridStyle === 'lines' ? '40px 40px'
      : gridStyle === 'dotsWide' ? '44px 44px'
        : gridStyle === 'dotsFine' ? '15px 15px'
          : ''
  );
  const cursorStyle = $derived(
    tool === 'hand' ? (handCursor || 'grab')
      : tool === 'eraser' ? 'cell'
        : 'crosshair'
  );

  onMount(() => {
    dpr = window.devicePixelRatio || 1;
    const onRestore = () => {
      if (inView) queueMicrotask(() => renderPage());
    };
    pdfCanvas?.addEventListener('contextrestored', onRestore);

    const onScroll = () => {
      if (cursorPoint) {
        cursorPoint = null;
        drawCursor();
      }
    };
    const scrollTarget = scrollRoot || wrap?.closest('.stage') || window;
    scrollTarget?.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      pdfCanvas?.removeEventListener('contextrestored', onRestore);
      scrollTarget?.removeEventListener('scroll', onScroll);
      window.removeEventListener('scroll', onScroll);
      if (currentRenderTask) {
        try { currentRenderTask.cancel(); } catch {}
        currentRenderTask = null;
      }
    };
  });

  // Keep rendered pages intact during continuous scrolling:
  // Pages outside the extended viewport release heavy canvas backing stores
  // but keep their placeholder element so scroll position is rock solid.
  $effect(() => {
    if (!wrap) return;
    if (!lazy || active) { inView = true; return; }
    if (typeof IntersectionObserver === 'undefined') { inView = true; return; }
    const rootEl = scrollRoot || wrap.closest('.stage') || null;
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (active) {
          inView = true;
        } else {
          inView = entry.isIntersecting;
        }
      }
    }, { root: rootEl, rootMargin: '600px 0px' });
    io.observe(wrap);
    return () => io.disconnect();
  });

  // Reclaim uncompressed bitmap memory when page moves out of view
  $effect(() => {
    if (!inView && !active && ready) {
      if (currentRenderTask) {
        try { currentRenderTask.cancel(); } catch {}
        currentRenderTask = null;
      }
      rendering = false;
      ready = false;
      renderedScale = 0;
      renderedRotation = 0;
      renderedDoc = null;
      if (pdfCanvas) {
        pdfCanvas.width = 1;
        pdfCanvas.height = 1;
      }
      shrinkOverlay(annCanvas);
      shrinkOverlay(markerCanvas);
      shrinkOverlay(redpenCanvas);
      shrinkOverlay(cursorCanvas);
      if (textLayerEl) {
        textLayerEl.textContent = '';
      }
    }
  });

  // Track the scale and rotation that the canvas currently displays
  let renderedScale = 0;
  let renderedRotation = 0;
  let renderedDoc = null;

  // Render whenever the document, page, zoom or rotation changes.
  $effect(() => {
    void pdfDoc;
    void pageNumber;
    void scale;
    void rotation;
    void inView;
    void lazy;
    if (!pdfDoc || !inView || !pdfCanvas) return;
    if (renderedScale === scale && renderedRotation === rotation && renderedDoc === pdfDoc && ready) return;
    queueMicrotask(() => renderPage());
  });

  async function renderPage() {
    if (!pdfDoc || !pdfCanvas || !inView) return;
    if (rendering) {
      queued = true;
      if (currentRenderTask) {
        try { currentRenderTask.cancel(); } catch {}
        currentRenderTask = null;
      }
      return;
    }
    rendering = true;
    const seq = ++renderSeq;
    const currentScale = scale;
    const currentRotation = rotation;
    const currentDoc = pdfDoc;

    try {
      const page = await pdfDoc.getPage(pageNumber);
      if (seq !== renderSeq) return;
      const base = page.getViewport({ scale: 1, rotation: 0 });
      if (Math.abs(base.width - baseWidth) > 0.5 || Math.abs(base.height - baseHeight) > 0.5) {
        onsize(pageNumber, base.width, base.height);
      }
      const renderedVp = await renderPageToCanvas(page, {
        scale: currentScale,
        rotation: currentRotation,
        canvas: pdfCanvas,
        dpr,
        onTask: (task) => { currentRenderTask = task; }
      });
      currentRenderTask = null;
      if (!renderedVp || seq !== renderSeq) return;
      renderedScale = currentScale;
      renderedRotation = currentRotation;
      renderedDoc = currentDoc;

      ensureOverlayCssSizes();
      // The page is usable as soon as the canvas is painted. Text selection is
      // layered on afterwards and must never hold the page in a loading state
      // (some PDF.js builds keep a text stream open on image-only pages).
      ready = true;
      onready(pageNumber, {
        pdfCanvas,
        annCanvas,
        markerCanvas,
        redpenCanvas,
        cursorCanvas,
        textLayerEl,
        wrap,
        baseWidth: base.width,
        baseHeight: base.height
      });
      drawAll();
      let textContent = null;
      try { textContent = await page.getTextContent(); } catch { /* image-only page */ }
      if (seq !== renderSeq) return;
      hasText = !!textContent?.items?.some((item) => String(item.str || '').trim().length > 2);
      // Image-only pages have no text to select: skip the extra stream so a page
      // whose text layer never settles cannot block the next zoom render.
      if (hasText) await renderTextLayer(page, { scale: currentScale, rotation: currentRotation, container: textLayerEl });
    } catch (err) {
      // If render failed unexpectedly (e.g. temporary context lost), retry if still in view
      if (seq === renderSeq && err?.name !== 'RenderingCancelledException') {
        setTimeout(() => { if (!rendering && inView) renderPage(); }, 250);
      }
    } finally {
      rendering = false;
      if (queued || renderedScale !== scale || renderedRotation !== rotation) {
        queued = false;
        renderPage();
      }
    }
  }

  function ensureOverlayCssSizes() {
    const w = `${Math.round(display.width)}px`;
    const h = `${Math.round(display.height)}px`;
    if (annCanvas) { annCanvas.style.width = w; annCanvas.style.height = h; }
    if (markerCanvas) { markerCanvas.style.width = w; markerCanvas.style.height = h; }
    if (redpenCanvas) { redpenCanvas.style.width = w; redpenCanvas.style.height = h; }
    if (cursorCanvas) { cursorCanvas.style.width = w; cursorCanvas.style.height = h; }
  }

  function sizeOverlay(canvas) {
    if (!canvas || !inView) return;
    const maxDim = Math.max(display.width, display.height);
    const safeDpr = maxDim * dpr > 3800 ? Math.max(1, 3800 / maxDim) : dpr;
    const w = Math.max(1, Math.round(display.width * safeDpr));
    const h = Math.max(1, Math.round(display.height * safeDpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    canvas.style.width = `${Math.round(display.width)}px`;
    canvas.style.height = `${Math.round(display.height)}px`;
  }

  function shrinkOverlay(canvas) {
    if (!canvas) return;
    if (canvas.width > 1 || canvas.height > 1) {
      canvas.width = 1;
      canvas.height = 1;
    }
    canvas.style.width = `${Math.round(display.width)}px`;
    canvas.style.height = `${Math.round(display.height)}px`;
  }

  // Annotation-only changes must redraw, not re-render the PDF.
  $effect(() => {
    void annotations;
    void viewFilter;
    void pageDraft;
    void redPen;
    void display;
    void pageRender;
    if (ready) drawAll();
  });

  function drawAll() {
    drawAnnotations();
    drawRedPen();
    drawCursor();
  }

  function drawAnnotations() {
    if (!annCanvas) return;
    ensureOverlayCssSizes();

    const isHighlighterItem = (a) => a.type === 'marker' || (a.type === 'shape' && (a.style?.fill_color || a.style?.filled));
    const markerItems = (annotations || []).filter(isHighlighterItem);
    const hasMarkerDraft = pageDraft && isHighlighterItem(pageDraft) && draftVisible(pageDraft.type);
    if (markerCanvas) {
      if (!markerItems.length && !hasMarkerDraft) {
        shrinkOverlay(markerCanvas);
      } else {
        sizeOverlay(markerCanvas);
        const markerCtx = markerCanvas.getContext('2d');
        if (markerCtx) {
          markerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
          markerCtx.clearRect(0, 0, markerCanvas.width, markerCanvas.height);
          renderAnnotations(markerCtx, markerItems, pageNumber, transform, { filter: viewFilter });
          if (hasMarkerDraft) {
            drawDraft(markerCtx, pageDraft, transform);
          }
        }
      }
    }

    const otherItems = (annotations || []).filter((a) => !isHighlighterItem(a));
    const hasOtherDraft = pageDraft && !isHighlighterItem(pageDraft) && draftVisible(pageDraft.type);
    sizeOverlay(annCanvas);
    const ctx = annCanvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, annCanvas.width, annCanvas.height);
      if (otherItems.length) {
        renderAnnotations(ctx, otherItems, pageNumber, transform, { filter: viewFilter });
      }
      if (hasOtherDraft) {
        drawDraft(ctx, pageDraft, transform);
      }
    }
  }

  function draftVisible(type) {
    if (viewFilter === 'highlights') return type === 'marker';
    if (viewFilter === 'annotations') return type !== 'marker';
    return true;
  }

  function drawDraft(ctx, d, t) {
    const g = d.geometry || {};
    ctx.save();
    ctx.globalAlpha = d.style.opacity ?? 1;
    ctx.strokeStyle = d.style.color || color;
    ctx.fillStyle = d.style.fill_color || 'transparent';
    ctx.lineWidth = t.strokeWidth(d.style.thickness || 0.012);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (d.type === 'marker' || d.type === 'pen') {
      const raw = d.points || g.points || [];
      const pts = raw.map((p) => t.toLocal(p[0], p[1]));
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.5, pts[0][1]);
      ctx.stroke();
    } else if (d.type === 'shape' && g.points) {
      const [p1, p2] = g.points.map((p) => t.toLocal(p[0], p[1]));
      const bbox = {
        x: Math.min(p1[0], p2[0]), y: Math.min(p1[1], p2[1]),
        w: Math.abs(p2[0] - p1[0]), h: Math.abs(p2[1] - p1[1])
      };
      const sh = g.shape || 'rectangle';
      if (sh === 'rectangle') {
        if (d.style.fill_color) { ctx.fillRect(bbox.x, bbox.y, bbox.w, bbox.h); }
        ctx.strokeRect(bbox.x, bbox.y, bbox.w, bbox.h);
      } else if (sh === 'ellipse') {
        ctx.beginPath();
        ctx.ellipse(bbox.x + bbox.w / 2, bbox.y + bbox.h / 2, bbox.w / 2, bbox.h / 2, 0, 0, Math.PI * 2);
        if (d.style.fill_color) ctx.fill();
        ctx.stroke();
      } else if (sh === 'line' || sh === 'arrow') {
        ctx.beginPath();
        ctx.moveTo(p1[0], p1[1]);
        ctx.lineTo(p2[0], p2[1]);
        ctx.stroke();
      } else {
        ctx.beginPath();
        if (sh === 'check') {
          ctx.moveTo(bbox.x + bbox.w * 0.15, bbox.y + bbox.h * 0.55);
          ctx.lineTo(bbox.x + bbox.w * 0.42, bbox.y + bbox.h * 0.82);
          ctx.lineTo(bbox.x + bbox.w * 0.88, bbox.y + bbox.h * 0.2);
        } else {
          ctx.moveTo(bbox.x + bbox.w * 0.15, bbox.y + bbox.h * 0.15);
          ctx.lineTo(bbox.x + bbox.w * 0.85, bbox.y + bbox.h * 0.85);
          ctx.moveTo(bbox.x + bbox.w * 0.85, bbox.y + bbox.h * 0.15);
          ctx.lineTo(bbox.x + bbox.w * 0.15, bbox.y + bbox.h * 0.85);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawRedPen() {
    if (!redpenCanvas) return;
    const strokes = (redPen || []).filter((s) => s.page === pageNumber);
    if (!strokes.length) {
      shrinkOverlay(redpenCanvas);
      return;
    }
    sizeOverlay(redpenCanvas);
    const ctx = redpenCanvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, redpenCanvas.width, redpenCanvas.height);
    for (const stroke of strokes) {
      const pts = (stroke.points || []).map((p) => transform.toLocal(p[0], p[1]));
      if (!pts.length) continue;
      ctx.save();
      ctx.globalAlpha = stroke.style?.opacity ?? 1;
      ctx.strokeStyle = stroke.style?.color || '#EB5757';
      ctx.lineWidth = transform.strokeWidth(stroke.style?.thickness || 0.012);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.stroke();
      ctx.restore();
    }
  }

  function pointerShowsSize() {
    return tool === 'marker' || tool === 'pen' || tool === 'pointer' || tool === 'shape' || tool === 'eraser';
  }

  function drawCursor() {
    if (!cursorCanvas) return;
    if (!cursorPoint || !interactive || !pointerShowsSize() || editor) {
      shrinkOverlay(cursorCanvas);
      return;
    }
    sizeOverlay(cursorCanvas);
    const ctx = cursorCanvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);
    const { lx, ly } = cursorPoint;
    const eraser = tool === 'eraser';
    const radius = eraser ? 7 : Math.max(1.5, sizePx / 2);
    const tint = eraser ? '#EB5757' : color;
    ctx.save();
    ctx.beginPath();
    ctx.arc(lx, ly, radius + 1, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(lx, ly, radius, 0, Math.PI * 2);
    ctx.fillStyle = rgba(tint, 0.18);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = rgba(tint, 0.95);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(lx, ly, 1, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(20,20,30,0.75)';
    ctx.fill();
    ctx.restore();
  }

  function rgba(hex, a) {
    const h = String(hex || '#000').replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    if (Number.isNaN(n)) return `rgba(0,0,0,${a})`;
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  function localPoint(e) {
    const rect = annCanvas.getBoundingClientRect();
    const lx = e.clientX - rect.left;
    const ly = e.clientY - rect.top;
    const [u, v] = transform.fromLocal(lx, ly);
    return { lx, ly, u, v };
  }

  function emit(type, e) {
    if (!interactive || !annCanvas) return;
    emitRaw(type, e);
  }

  function emitRaw(type, e) {
    if (!annCanvas) return;
    const point = localPoint(e);
    onpointer({ type, page: pageNumber, event: e, ...point });
  }

  function onPointerDown(e) {
    if (!interactive) return;
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* no active pointer */ }
    emit('down', e);
  }
  function onPointerMove(e) {
    if (!interactive) return;
    const point = localPoint(e);
    cursorPoint = { lx: point.lx, ly: point.ly };
    drawCursor();
    emitRaw('move', e);
  }
  function onPointerUp(e) {
    if (!interactive) return;
    emitRaw('up', e);
    if (e && e.clientX !== undefined) {
      const point = localPoint(e);
      cursorPoint = { lx: point.lx, ly: point.ly };
      drawCursor();
    }
  }
  function onPointerLeave() {
    cursorPoint = null;
    drawCursor();
  }

  // --- text box --------------------------------------------------------------
  // The editor is local to this page so a continuous strip can keep every page
  // independent. Reader opens it with a request; this component reports the
  // finished box back with normalized geometry.
  $effect(() => {
    const req = textRequest;
    if (!req || req.page !== pageNumber) {
      if (editor) { editor = null; editorRequestKey = null; }
      return;
    }
    if (req.key !== editorRequestKey) {
      editorRequestKey = req.key;
      editor = { ...req };
      editorSeq++;
    }
  });

  function closeEditor(save) {
    if (!editor) return;
    const value = { ...editor };
    editor = null;
    editorRequestKey = null;
    if (!save) return;
    const [u, v] = transform.fromLocal(value.lx, value.ly);
    ontextdone({
      page: pageNumber,
      id: value.id || null,
      u, v,
      wNorm: value.w / transform.displayWidth,
      hNorm: value.h / transform.displayHeight,
      fontNorm: value.fontSize / Math.max(1, baseHeight * scale),
      text: String(value.text || '').trim(),
      color: value.color,
      direction: value.direction,
      fontSize: value.fontSize,
      fontFamily: value.fontFamily || DEFAULT_ANNOTATION_FONT
    });
  }

  function onEditorKey(e) {
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      closeEditor(true);
      return;
    }
    e.stopPropagation();
  }

  function onEditorFocusOut(e) {
    if (e.currentTarget && e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return;
    closeEditor(true);
  }

  function focusEditor(node) {
    node.focus();
    try { node.select(); } catch { /* no selection */ }
  }

  function pinStyle(b) {
    const [x, y] = transform.toLocal(b.u, b.v);
    return `left:${x}px; top:${y}px`;
  }

  function captureStyle(r) {
    return `left:${Math.min(r.lx, r.lx + r.w)}px; top:${Math.min(r.ly, r.ly + r.h)}px; width:${Math.abs(r.w)}px; height:${Math.abs(r.h)}px`;
  }
</script>

<div class="page-wrap"
  class:is-text-page={hasText}
  class:blank-page={pageRender === 'blank'}
  class:page-ready={ready}
  class:is-active={active}
  data-page={pageNumber}
  bind:this={wrap}
  style="width:{Math.round(display.width)}px; height:{Math.round(display.height)}px">
  <canvas class="pdf" bind:this={pdfCanvas} aria-label={tr('reader.pageOf', { n: pageNumber, total: totalPages || pageNumber })}></canvas>
  <div class="text-layer" bind:this={textLayerEl}></div>
  {#if gridStyle}<div class="grid-guide" style="background-image:{gridImage}; background-size:{gridSize}; opacity:.45"></div>{/if}
  <canvas class="marker-overlay" bind:this={markerCanvas}></canvas>
  <canvas class="redpen-overlay" bind:this={redpenCanvas}></canvas>
  <canvas class="cursor-overlay" bind:this={cursorCanvas}></canvas>
  <canvas class="ann" bind:this={annCanvas}
    class:tool-hand={tool === 'hand'}
    class:is-panning={panning && tool === 'hand'}
    style="cursor:{cursorStyle}"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    onpointerleave={onPointerLeave}></canvas>

  {#each pageBookmarks as b (b.id)}
    <span class="bookmark-pin {activeBookmark === b.id ? 'active' : ''}" style={pinStyle(b)}
      data-bookmark-id={b.id} title={typeof b.u === 'number' ? tr('reader.spotBookmark', { n: b.page }) : tr('reader.pageBookmark', { n: b.page })} aria-hidden="true">
      <Icon name="bookmark" size={16} />
    </span>
  {/each}

  {#if pageCapture}
    <div class="capture-rect" style={captureStyle(pageCapture)}></div>
  {/if}

  {#if editor}
    <div class="text-editor-layer" onfocusout={onEditorFocusOut}>
      <div class="text-editor-tools" style="left:{editor.lx}px; top:{Math.max(2, editor.ly - 46)}px">
        <select bind:value={editor.fontFamily} title={tr('annotation.fontFamily')} aria-label={tr('annotation.fontFamily')} style="max-width:110px">
          {#each ANNOTATION_FONTS as f}
            <option value={f.id}>{f.name}</option>
          {/each}
        </select>
        <select bind:value={editor.direction} title={tr('editor.direction')} aria-label={tr('editor.direction')}>
          <option value="auto">{tr('editor.auto')}</option><option value="ltr">LTR</option><option value="rtl">RTL</option>
        </select>
        <span class="stepper" role="group" aria-label={tr('editor.fontSize')}>
          <button onclick={() => (editor.fontSize = Math.max(8, editor.fontSize - 2))} title={tr('tool.sizeDown', { n: editor.fontSize - 2 })} aria-label={tr('tool.sizeDown', { n: editor.fontSize - 2 })}><Icon name="minus" size={12} /></button>
          <span class="stepper-value" title={tr('editor.fontSize')}>{editor.fontSize}</span>
          <button onclick={() => (editor.fontSize = Math.min(72, editor.fontSize + 2))} title={tr('tool.sizeUp', { n: editor.fontSize + 2 })} aria-label={tr('tool.sizeUp', { n: editor.fontSize + 2 })}><Icon name="plus" size={12} /></button>
        </span>
        <input type="color" bind:value={editor.color} style="width:34px; padding:1px" title={tr('editor.color')} aria-label={tr('editor.color')} />
        <button class="primary" onclick={() => closeEditor(true)}>{tr('editor.done')}</button>
      </div>
      <textarea class="text-editor" use:focusEditor
        style="left:{editor.lx}px; top:{editor.ly}px; width:{editor.w}px; height:{editor.h}px; font-size:{editor.fontSize}px; color:{editor.color}; font-family:{editor.fontFamily || DEFAULT_ANNOTATION_FONT}; direction:{editor.direction === 'auto' ? 'ltr' : editor.direction}"
        placeholder={tr('editor.placeholder')}
        bind:value={editor.text} onkeydown={onEditorKey}></textarea>
    </div>
  {/if}
</div>
