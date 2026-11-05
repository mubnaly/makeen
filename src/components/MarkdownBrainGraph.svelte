<script>
  import { onMount, onDestroy } from 'svelte';
  import Icon from './Icon.svelte';
  import { t } from '../lib/lang.svelte.js';
  import {
    listAllNotes,
    getKnowledgeGraphData,
    connectNotes,
    disconnectNotes,
    getNoteLinks
  } from '../lib/markdownStore.js';

  let {
    activeNoteId = null,
    onOpenNote = null,
    onClose = null,
    notify = null
  } = $props();

  let canvasEl = $state();
  let containerEl = $state();
  let animId = null;

  // Graph data & simulation state
  let rawNodes = [];
  let rawEdges = [];
  let nodes = [];
  let edges = [];
  let allNotesList = $state([]);

  // Transform (pan & zoom)
  let zoom = $state(1);
  let panX = $state(0);
  let panY = $state(0);
  let isPanning = false;
  let startPanX = 0;
  let startPanY = 0;

  // Interaction
  let hoveredNode = $state(null);
  let selectedNodeId = $state(activeNoteId || null);
  let draggedNode = null;
  let connectSourceNode = $state(null);
  let connectCursorPos = $state({ x: 0, y: 0 });
  let isConnectMode = $state(false);
  let searchQuery = $state('');

  // Selected node details
  let selectedNode = $derived(nodes.find((n) => n.id === selectedNodeId) || null);
  let connectedNotes = $state([]);
  let targetConnectNoteId = $state('');

  // Physics params
  const REPULSION = 2200;
  const SPRING_LENGTH = 110;
  const SPRING_STRENGTH = 0.04;
  const GRAVITY = 0.02;
  const DAMPING = 0.86;

  function refreshGraphData() {
    allNotesList = listAllNotes();
    const data = getKnowledgeGraphData();
    rawNodes = data.nodes || [];
    rawEdges = data.edges || [];

    // Keep existing node coordinates if already present
    const existingMap = new Map(nodes.map((n) => [n.id, n]));
    const width = containerEl?.clientWidth || 800;
    const height = containerEl?.clientHeight || 600;

    nodes = rawNodes.map((n, idx) => {
      const prev = existingMap.get(n.id);
      if (prev) {
        return {
          ...n,
          x: prev.x,
          y: prev.y,
          vx: prev.vx,
          vy: prev.vy,
          radius: Math.min(28, Math.max(14, 14 + (n.connectionsCount || 0) * 2.5))
        };
      }
      // Distribute in a soft circle around center
      const angle = (idx / Math.max(1, rawNodes.length)) * Math.PI * 2;
      const dist = 80 + Math.random() * 140;
      return {
        ...n,
        x: width / 2 + Math.cos(angle) * dist,
        y: height / 2 + Math.sin(angle) * dist,
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2,
        radius: Math.min(28, Math.max(14, 14 + (n.connectionsCount || 0) * 2.5))
      };
    });

    edges = rawEdges;
    updateConnectedNotes();
  }

  function updateConnectedNotes() {
    if (!selectedNodeId) {
      connectedNotes = [];
      return;
    }
    connectedNotes = getNoteLinks(selectedNodeId);
  }

  function stepPhysics() {
    if (!nodes.length) return;
    const width = containerEl?.clientWidth || 800;
    const height = containerEl?.clientHeight || 600;
    const centerX = width / 2;
    const centerY = height / 2;

    // Node-node repulsion
    for (let i = 0; i < nodes.length; i++) {
      const n1 = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const n2 = nodes[j];
        const dx = n2.x - n1.x;
        const dy = n2.y - n1.y;
        const distSq = dx * dx + dy * dy;
        const dist = Math.sqrt(distSq) || 1;
        if (dist < 500) {
          const force = REPULSION / Math.max(100, distSq);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          if (n1 !== draggedNode) { n1.vx -= fx; n1.vy -= fy; }
          if (n2 !== draggedNode) { n2.vx += fx; n2.vy += fy; }
        }
      }
    }

    // Edge spring attraction
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    for (const edge of edges) {
      const src = nodeMap.get(edge.source);
      const tgt = nodeMap.get(edge.target);
      if (!src || !tgt) continue;
      const dx = tgt.x - src.x;
      const dy = tgt.y - src.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (dist - SPRING_LENGTH) * SPRING_STRENGTH;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      if (src !== draggedNode) { src.vx += fx; src.vy += fy; }
      if (tgt !== draggedNode) { tgt.vx -= fx; tgt.vy -= fy; }
    }

    // Center gravity & update positions
    for (const n of nodes) {
      if (n === draggedNode) continue;
      n.vx += (centerX - n.x) * GRAVITY;
      n.vy += (centerY - n.y) * GRAVITY;
      n.vx *= DAMPING;
      n.vy *= DAMPING;
      n.x += n.vx;
      n.y += n.vy;
    }
  }

  function getNodeColor(materialType) {
    if (materialType === 'pdf') return '#10b981'; // emerald
    if (materialType === 'video') return '#f59e0b'; // amber
    return '#8b5cf6'; // purple / accent
  }

  function render() {
    if (!canvasEl) return;
    const ctx = canvasEl.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const width = canvasEl.width / dpr;
    const height = canvasEl.height / dpr;

    ctx.clearRect(0, 0, width, height);

    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const q = searchQuery.trim().toLowerCase();

    // 1. Draw Edges
    for (const edge of edges) {
      const src = nodeMap.get(edge.source);
      const tgt = nodeMap.get(edge.target);
      if (!src || !tgt) continue;

      const isConnectedToSelected = selectedNodeId && (src.id === selectedNodeId || tgt.id === selectedNodeId);
      const isConnectedToHovered = hoveredNode && (src.id === hoveredNode.id || tgt.id === hoveredNode.id);

      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.lineTo(tgt.x, tgt.y);

      if (isConnectedToSelected || isConnectedToHovered) {
        ctx.strokeStyle = 'rgba(167, 139, 250, 0.85)';
        ctx.lineWidth = 2.4;
      } else {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 1.2;
      }
      ctx.stroke();
    }

    // Connect drag preview line
    if (connectSourceNode) {
      ctx.beginPath();
      ctx.moveTo(connectSourceNode.x, connectSourceNode.y);
      ctx.lineTo(connectCursorPos.x, connectCursorPos.y);
      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 2. Draw Nodes
    for (const n of nodes) {
      const isSelected = n.id === selectedNodeId;
      const isHovered = hoveredNode && n.id === hoveredNode.id;
      const isMatch = q ? n.title.toLowerCase().includes(q) : true;
      const baseColor = getNodeColor(n.materialType);

      ctx.save();

      // Outer glow for selected or hovered
      if (isSelected || isHovered) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius + 7, 0, Math.PI * 2);
        ctx.fillStyle = isSelected ? 'rgba(139, 92, 246, 0.35)' : 'rgba(255, 255, 255, 0.15)';
        ctx.fill();
      }

      // Circle node body
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
      ctx.fillStyle = isMatch ? baseColor : 'rgba(100, 100, 115, 0.4)';
      ctx.fill();

      ctx.lineWidth = isSelected ? 3 : 1.5;
      ctx.strokeStyle = isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.5)';
      ctx.stroke();

      // Node Label
      const labelText = n.title.length > 20 ? n.title.slice(0, 18) + '…' : n.title;
      ctx.font = isSelected ? 'bold 12px "Segoe UI", Tahoma, sans-serif' : '11px "Segoe UI", Tahoma, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';

      // Label background pill
      const textMetrics = ctx.measureText(labelText);
      const pillWidth = textMetrics.width + 10;
      const pillHeight = 16;
      const pillX = n.x - pillWidth / 2;
      const pillY = n.y + n.radius + 4;

      ctx.fillStyle = 'rgba(15, 15, 22, 0.85)';
      ctx.beginPath();
      ctx.roundRect(pillX, pillY, pillWidth, pillHeight, 4);
      ctx.fill();

      ctx.fillStyle = isSelected ? '#ffffff' : (isMatch ? '#e2e8f0' : '#888898');
      ctx.fillText(labelText, n.x, pillY + 2);

      ctx.restore();
    }

    ctx.restore();
  }

  function loop() {
    stepPhysics();
    render();
    animId = requestAnimationFrame(loop);
  }

  function resizeCanvas() {
    if (!canvasEl || !containerEl) return;
    const dpr = window.devicePixelRatio || 1;
    const width = containerEl.clientWidth;
    const height = containerEl.clientHeight;
    canvasEl.width = width * dpr;
    canvasEl.height = height * dpr;
    canvasEl.style.width = width + 'px';
    canvasEl.style.height = height + 'px';
    const ctx = canvasEl.getContext('2d');
    ctx.scale(dpr, dpr);
  }

  function getGraphCoords(e) {
    const rect = canvasEl.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    return {
      x: (screenX - panX) / zoom,
      y: (screenY - panY) / zoom
    };
  }

  function findNodeAt(coords) {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const dx = coords.x - n.x;
      const dy = coords.y - n.y;
      if (dx * dx + dy * dy <= (n.radius + 6) * (n.radius + 6)) {
        return n;
      }
    }
    return null;
  }

  function onPointerDown(e) {
    if (e.button !== 0) return;
    const coords = getGraphCoords(e);
    const hit = findNodeAt(coords);

    if (isConnectMode && hit) {
      connectSourceNode = hit;
      connectCursorPos = coords;
      return;
    }

    if (hit) {
      draggedNode = hit;
      selectedNodeId = hit.id;
      updateConnectedNotes();
    } else {
      isPanning = true;
      startPanX = e.clientX - panX;
      startPanY = e.clientY - panY;
    }
  }

  function onPointerMove(e) {
    const coords = getGraphCoords(e);

    if (connectSourceNode) {
      connectCursorPos = coords;
      return;
    }

    if (draggedNode) {
      draggedNode.x = coords.x;
      draggedNode.y = coords.y;
      draggedNode.vx = 0;
      draggedNode.vy = 0;
      return;
    }

    if (isPanning) {
      panX = e.clientX - startPanX;
      panY = e.clientY - startPanY;
      return;
    }

    hoveredNode = findNodeAt(coords);
    if (canvasEl) {
      canvasEl.style.cursor = hoveredNode ? 'pointer' : (isPanning ? 'grabbing' : 'default');
    }
  }

  function onPointerUp(e) {
    if (connectSourceNode) {
      const coords = getGraphCoords(e);
      const target = findNodeAt(coords);
      if (target && target.id !== connectSourceNode.id) {
        connectNotes(connectSourceNode.id, target.id);
        notify?.(t('notes.saved') || 'Notes connected', 'ok');
        refreshGraphData();
      }
      connectSourceNode = null;
      return;
    }

    if (draggedNode) {
      draggedNode = null;
    }
    isPanning = false;
  }

  function onWheel(e) {
    e.preventDefault();
    const rect = canvasEl.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89;
    const newZoom = Math.min(3.2, Math.max(0.35, zoom * zoomFactor));

    // Zoom towards mouse pointer
    panX = mouseX - (mouseX - panX) * (newZoom / zoom);
    panY = mouseY - (mouseY - panY) * (newZoom / zoom);
    zoom = newZoom;
  }

  function handleConnectSelected() {
    if (!selectedNodeId || !targetConnectNoteId) return;
    if (selectedNodeId === targetConnectNoteId) return;
    connectNotes(selectedNodeId, targetConnectNoteId);
    targetConnectNoteId = '';
    notify?.(t('notes.saved') || 'Notes connected', 'ok');
    refreshGraphData();
  }

  function handleDisconnect(targetId) {
    if (!selectedNodeId || !targetId) return;
    disconnectNotes(selectedNodeId, targetId);
    notify?.(t('notes.saved') || 'Connection removed', 'ok');
    refreshGraphData();
  }

  function resetView() {
    zoom = 1;
    const width = containerEl?.clientWidth || 800;
    const height = containerEl?.clientHeight || 600;
    panX = 0;
    panY = 0;
    refreshGraphData();
  }

  function zoomIn() {
    zoom = Math.min(3.2, zoom * 1.25);
  }

  function zoomOut() {
    zoom = Math.max(0.35, zoom * 0.8);
  }

  onMount(() => {
    resizeCanvas();
    refreshGraphData();
    animId = requestAnimationFrame(loop);
    window.addEventListener('resize', resizeCanvas);
  });

  onDestroy(() => {
    if (animId) cancelAnimationFrame(animId);
    if (typeof window !== 'undefined') window.removeEventListener('resize', resizeCanvas);
  });
</script>

<div class="brain-graph-root" bind:this={containerEl}>
  <!-- Top Graph Control Toolbar -->
  <header class="graph-topbar">
    <div class="topbar-left hstack" style="gap:10px">
      <div class="graph-badge hstack" style="gap:6px">
        <Icon name="brain" size={17} />
        <span class="graph-title">{t('notes.viewGraph') || 'Brain Graph'}</span>
      </div>
      <span class="stats-chip">{nodes.length} {t('notes.nodeCount') || 'notes'} · {edges.length} {t('notes.edgeCount') || 'links'}</span>
    </div>

    <!-- Live Search on Graph -->
    <div class="graph-search-box">
      <Icon name="search" size={14} />
      <input
        type="text"
        placeholder={t('topbar.search') || 'Search notes on brain graph...'}
        bind:value={searchQuery}
        aria-label="Search graph notes"
      />
      {#if searchQuery}
        <button class="clear-search-btn" onclick={() => (searchQuery = '')} aria-label="Clear search">
          <Icon name="x" size={12} />
        </button>
      {/if}
    </div>

    <div class="topbar-right hstack" style="gap:6px">
      <!-- Connect mode toggle -->
      <button
        type="button"
        class="action-btn {isConnectMode ? 'active' : ''}"
        onclick={() => (isConnectMode = !isConnectMode)}
        title={t('notes.connect') || 'Connect Mode (Drag between notes)'}
      >
        <Icon name="link" size={14} />
        <span>{t('notes.connect') || 'Connect'}</span>
      </button>

      <button type="button" class="icon-btn" onclick={zoomIn} title={t('notes.zoomIn') || 'Zoom in'} aria-label="Zoom in">
        <Icon name="plus" size={15} />
      </button>
      <button type="button" class="icon-btn" onclick={zoomOut} title={t('notes.zoomOut') || 'Zoom out'} aria-label="Zoom out">
        <Icon name="minus" size={15} />
      </button>
      <button type="button" class="icon-btn" onclick={resetView} title={t('notes.resetView') || 'Reset view'} aria-label="Reset view">
        <Icon name="repeat" size={15} />
      </button>

      {#if onClose}
        <button type="button" class="action-btn primary" onclick={onClose}>
          <Icon name="file-text" size={14} />
          <span>{t('notes.viewEditor') || 'Notes Editor'}</span>
        </button>
      {/if}
    </div>
  </header>

  <!-- Canvas Stage -->
  <div class="canvas-wrap">
    <canvas
      bind:this={canvasEl}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onwheel={onWheel}
    ></canvas>

    <!-- Connect Dragging Floating Hint -->
    {#if connectSourceNode}
      <div class="connect-floating-hint">
        {t('notes.connect') || 'Drop on target note to connect'}
      </div>
    {/if}

    <!-- Right Side Details Drawer for Selected Node -->
    {#if selectedNode}
      <aside class="node-inspector-card">
        <div class="inspector-header hstack" style="justify-content:space-between">
          <div class="hstack" style="gap:6px; min-width:0">
            <span class="type-dot" style="background:{getNodeColor(selectedNode.materialType)}"></span>
            <h4 class="inspector-title" title={selectedNode.title}>{selectedNode.title}</h4>
          </div>
          <button class="icon-btn mini" onclick={() => (selectedNodeId = null)} aria-label="Close details">
            <Icon name="x" size={13} />
          </button>
        </div>

        {#if selectedNode.contentPreview}
          <p class="inspector-preview">{selectedNode.contentPreview}...</p>
        {/if}

        <div class="inspector-actions hstack" style="gap:6px; margin: 8px 0">
          <button
            type="button"
            class="primary small grow hstack"
            style="justify-content:center"
            onclick={() => onOpenNote?.(selectedNode.id)}
          >
            <Icon name="file-text" size={14} />
            <span>{t('notes.openInEditor') || 'Open Note'}</span>
          </button>
        </div>

        <!-- Add Connection Selector -->
        <div class="inspector-section">
          <label class="section-label" for="connect-select">{t('notes.connect') || 'Connect to another note:'}</label>
          <div class="hstack" style="gap:6px">
            <select id="connect-select" class="connect-select" bind:value={targetConnectNoteId}>
              <option value="">{t('notes.connectPlaceholder') || 'Select note...'}</option>
              {#each allNotesList.filter((n) => n.id !== selectedNode.id && !connectedNotes.some((c) => c.id === n.id)) as optNote (optNote.id)}
                <option value={optNote.id}>{optNote.title}</option>
              {/each}
            </select>
            <button
              type="button"
              class="primary small"
              onclick={handleConnectSelected}
              disabled={!targetConnectNoteId}
              title={t('notes.connect') || 'Connect'}
            >
              <Icon name="link" size={13} />
            </button>
          </div>
        </div>

        <!-- Connected Notes List -->
        <div class="inspector-section" style="margin-top:12px">
          <div class="section-label">{t('notes.connectedNotes', { n: connectedNotes.length }) || `Connected Notes (${connectedNotes.length})`}</div>
          {#if connectedNotes.length === 0}
            <div class="empty-muted">{t('notes.noConnections') || 'No connections yet'}</div>
          {:else}
            <div class="connections-list">
              {#each connectedNotes as conn (conn.id)}
                <div class="connection-row hstack" style="justify-content:space-between">
                  <button
                    type="button"
                    class="conn-title-btn"
                    onclick={() => { selectedNodeId = conn.id; updateConnectedNotes(); }}
                    title={conn.title}
                  >
                    <span class="type-dot mini" style="background:{getNodeColor(conn.materialType)}"></span>
                    <span class="conn-name">{conn.title}</span>
                  </button>
                  <button
                    type="button"
                    class="disconnect-btn"
                    onclick={() => handleDisconnect(conn.id)}
                    title={t('notes.disconnect') || 'Disconnect'}
                    aria-label={t('notes.disconnect') || 'Disconnect'}
                  >
                    <Icon name="x" size={12} />
                  </button>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </aside>
    {/if}
  </div>
</div>

<style>
  .brain-graph-root {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #0f0f16;
    color: #e2e8f0;
    position: relative;
    user-select: none;
  }

  .graph-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
    background: rgba(20, 20, 30, 0.95);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    backdrop-filter: blur(10px);
    z-index: 10;
    gap: 12px;
  }

  .graph-badge {
    color: var(--accent, #a855f7);
    font-weight: 700;
    font-size: 15px;
  }

  .stats-chip {
    font-size: 11.5px;
    background: rgba(255, 255, 255, 0.08);
    padding: 3px 8px;
    border-radius: 99px;
    color: #94a3b8;
  }

  .graph-search-box {
    display: flex;
    align-items: center;
    gap: 8px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    padding: 4px 10px;
    width: 280px;
    max-width: 35%;
  }
  .graph-search-box input {
    background: transparent;
    border: none;
    outline: none;
    color: #fff;
    font-size: 12.5px;
    width: 100%;
  }

  .clear-search-btn {
    background: transparent;
    border: none;
    color: #94a3b8;
    cursor: pointer;
    padding: 2px;
  }

  .action-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 7px;
    font-size: 12.5px;
    font-weight: 500;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #e2e8f0;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .action-btn:hover {
    background: rgba(255, 255, 255, 0.14);
  }
  .action-btn.active {
    background: var(--accent, #a855f7);
    color: #fff;
    border-color: transparent;
  }
  .action-btn.primary {
    background: var(--accent, #a855f7);
    color: #fff;
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: 7px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #cbd5e1;
    cursor: pointer;
    transition: background 0.15s ease;
  }
  .icon-btn:hover { background: rgba(255, 255, 255, 0.14); color: #fff; }
  .icon-btn.mini { width: 24px; height: 24px; }

  .canvas-wrap {
    flex: 1;
    position: relative;
    overflow: hidden;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }

  .connect-floating-hint {
    position: absolute;
    top: 16px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(168, 85, 247, 0.9);
    color: #fff;
    padding: 6px 14px;
    border-radius: 99px;
    font-size: 12px;
    font-weight: 600;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    pointer-events: none;
    animation: pulse 1.5s infinite ease-in-out;
  }

  @keyframes pulse {
    0%, 100% { opacity: 0.9; transform: translateX(-50%) scale(1); }
    50% { opacity: 1; transform: translateX(-50%) scale(1.04); }
  }

  /* Node Details & Connections Drawer */
  .node-inspector-card {
    position: absolute;
    top: 14px;
    right: 14px;
    width: 300px;
    max-height: calc(100% - 28px);
    background: rgba(22, 22, 34, 0.96);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 12px;
    padding: 14px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(14px);
    overflow-y: auto;
    z-index: 20;
    display: flex;
    flex-direction: column;
    gap: 8px;
    animation: slideIn 0.2s ease-out;
  }

  @keyframes slideIn {
    from { opacity: 0; transform: translateX(12px); }
    to { opacity: 1; transform: translateX(0); }
  }

  .inspector-title {
    margin: 0;
    font-size: 14px;
    font-weight: 700;
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .inspector-preview {
    font-size: 11.5px;
    color: #94a3b8;
    line-height: 1.45;
    margin: 0;
    max-height: 48px;
    overflow: hidden;
  }

  .type-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    flex: none;
  }
  .type-dot.mini { width: 7px; height: 7px; }

  .section-label {
    font-size: 11px;
    color: #94a3b8;
    margin-bottom: 4px;
    font-weight: 600;
    display: block;
  }

  .connect-select {
    flex: 1;
    min-width: 0;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 6px;
    color: #fff;
    padding: 5px 8px;
    font-size: 12px;
    outline: none;
  }
  .connect-select option {
    background: #181824;
    color: #fff;
  }

  .connections-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 180px;
    overflow-y: auto;
  }

  .connection-row {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 6px;
    padding: 4px 8px;
    transition: background 0.15s ease;
  }
  .connection-row:hover { background: rgba(255, 255, 255, 0.08); }

  .conn-title-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    background: transparent;
    border: none;
    color: #e2e8f0;
    font-size: 12px;
    cursor: pointer;
    text-align: start;
    min-width: 0;
    overflow: hidden;
    padding: 0;
  }
  .conn-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .disconnect-btn {
    background: transparent;
    border: none;
    color: #94a3b8;
    cursor: pointer;
    padding: 2px;
    border-radius: 4px;
    transition: all 0.15s ease;
  }
  .disconnect-btn:hover {
    color: #ef4444;
    background: rgba(239, 68, 68, 0.15);
  }

  .empty-muted {
    font-size: 11.5px;
    color: #64748b;
    font-style: italic;
    padding: 4px 0;
  }

  .grow { flex: 1; }
  .hstack { display: flex; align-items: center; }
</style>
