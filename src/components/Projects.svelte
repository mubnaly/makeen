<script>
  // Projects: one study unit that can hold many PDFs, videos, flashcard sets and
  // screenshots, plus an editable PDF draft. Capture tagging happens in App
  // (`projectId` on the capture); this component only presents and edits the
  // project record.
  import Icon from './Icon.svelte';
  import { imagesToPdf, deliverBytes } from '../lib/export.js';
  import { labelPng } from '../lib/labels.js';
  import { safeBaseName } from '../lib/filenames.js';
  import { formatTimecode } from '../lib/media.js';
  import { parseYouTube } from '../lib/youtube.js';
  import {
    capturesForProject, composerPlan, projectCounts,
    linkSource, unlinkSource, addComposerImage, addComposerText,
    addAllProjectImages, updateComposerEntry, removeComposerEntry,
    moveComposerEntry, clearComposer,
    createChannelProject, toggleChannelVideoInStudyList, setAllChannelVideosInStudyList,
    createProjectFolder, updateProjectFolder, removeProjectFolder,
    addResourceToFolder, removeResourceFromFolder, moveResourceInFolder
  } from '../lib/projects.js';
  import { t as tr } from '../lib/lang.svelte.js';

  let {
    projects = [],
    activeProject = null,
    docs = [],
    videos = [],
    decks = [],
    captures = [],
    notify,
    onSelect,
    onCreate,
    onCreateChannelProject = null,
    onPlayChannelVideo = null,
    onUpdate,
    onDelete,
    onBack,
    onOpenSource,
    onOpenSet,
    onAssignCapture,
    onUnassignCapture,
    onExported
  } = $props();

  let creating = $state(false);
  let newName = $state('');
  let newDescription = $state('');
  let docPick = $state('');
  let videoPick = $state('');
  let setPick = $state('');
  let imagePick = $state('');
  let newText = $state('');
  let exporting = $state(false);

  // Channel Import Modal & Search states
  let channelModalOpen = $state(false);
  let channelInput = $state('');
  let channelLoading = $state(false);
  let channelError = $state('');
  let fetchedChannel = $state(null);
  let channelSearchQuery = $state('');

  // Folder states & management
  let creatingFolder = $state(false);
  let newFolderName = $state('');
  let newFolderColor = $state('#3b82f6');
  let activeFolderForAdd = $state(null);
  let addResourceType = $state('all');
  let resourceSearchQuery = $state('');
  let addYoutubeUrl = $state('');
  let addResourceTitle = $state('');
  let collapsedFolders = $state(new Set());

  const projectFolders = $derived(activeProject?.folders || []);
  const targetFolder = $derived(projectFolders.find((f) => f.id === activeFolderForAdd));

  const allExistingResources = $derived.by(() => {
    const list = [];
    for (const v of videos) {
      list.push({
        type: 'video',
        refId: v.id,
        title: v.title || v.id,
        sub: v.provider === 'youtube' ? 'YouTube' : 'Video'
      });
    }
    for (const d of docs) {
      list.push({
        type: 'pdf',
        refId: d.id,
        title: d.title || d.id,
        sub: 'PDF'
      });
    }
    for (const name of decks) {
      list.push({
        type: 'deck',
        refId: name,
        title: name,
        sub: tr('projects.resourceDeck')
      });
    }
    for (const c of captures) {
      list.push({
        type: 'image',
        refId: c.id,
        title: c.name || c.id || 'Capture',
        sub: tr('projects.resourceImage')
      });
    }
    return list;
  });

  const filteredExistingResources = $derived.by(() => {
    let list = allExistingResources;
    if (addResourceType !== 'all') {
      list = list.filter((item) => item.type === addResourceType);
    }
    const q = resourceSearchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((item) =>
        item.title.toLowerCase().includes(q) || item.sub.toLowerCase().includes(q)
      );
    }
    return list;
  });

  function isItemInActiveFolder(resItem) {
    if (!targetFolder || !resItem) return false;
    return (targetFolder.items || []).some(
      (it) => it.type === resItem.type && String(it.refId) === String(resItem.refId)
    );
  }

  function toggleFolder(folderId) {
    const next = new Set(collapsedFolders);
    if (next.has(folderId)) next.delete(folderId);
    else next.add(folderId);
    collapsedFolders = next;
  }

  function handleCreateFolder() {
    const name = newFolderName.trim();
    if (!name || !activeProject) return;
    onUpdate(createProjectFolder(activeProject, name, newFolderColor));
    newFolderName = '';
    creatingFolder = false;
  }

  function handleDeleteFolder(folderId) {
    if (!activeProject || !folderId) return;
    onUpdate(removeProjectFolder(activeProject, folderId));
  }

  function handleToggleExistingItem(folderId, resItem) {
    if (!activeProject || !folderId || !resItem) return;
    const tf = projectFolders.find((f) => f.id === folderId);
    const existing = (tf?.items || []).find(
      (it) => it.type === resItem.type && String(it.refId) === String(resItem.refId)
    );
    if (existing) {
      onUpdate(removeResourceFromFolder(activeProject, folderId, existing.id));
    } else {
      const item = {
        type: resItem.type,
        refId: resItem.refId,
        title: resItem.title,
        url: resItem.url || ''
      };
      onUpdate(addResourceToFolder(activeProject, folderId, item));
    }
  }

  function handleAddCustomYoutube(folderId) {
    if (!activeProject || !folderId) return;
    const raw = addYoutubeUrl.trim();
    if (!raw) return;
    const parsed = parseYouTube(raw);
    const ytId = parsed ? parsed.id : raw;
    const title = addResourceTitle.trim() || `YouTube: ${ytId}`;
    const item = { type: 'youtube', refId: ytId, title, url: parsed?.url || raw };
    onUpdate(addResourceToFolder(activeProject, folderId, item));
    addYoutubeUrl = '';
    addResourceTitle = '';
  }

  function handleRemoveResource(folderId, itemId) {
    if (!activeProject) return;
    onUpdate(removeResourceFromFolder(activeProject, folderId, itemId));
  }

  function openFolderResource(item) {
    if (!item) return;
    if (item.type === 'pdf') {
      onOpenSource('pdf', item.refId);
    } else if (item.type === 'video') {
      onOpenSource('video', item.refId);
    } else if (item.type === 'youtube') {
      if (typeof onPlayChannelVideo === 'function') {
        onPlayChannelVideo({ id: item.refId, title: item.title, url: item.url }, activeProject);
      } else {
        onOpenSource('video', item.refId);
      }
    } else if (item.type === 'deck') {
      onOpenSet(item.refId);
    }
  }

  const projectCaptures = $derived(capturesForProject(activeProject, captures));
  const counts = $derived(projectCounts(activeProject, captures, [...docs, ...videos]));
  const linkedDocs = $derived((activeProject?.docs || []).map((id) => docs.find((d) => d.id === id)).filter(Boolean));
  const linkedVideos = $derived((activeProject?.videos || []).map((id) => videos.find((d) => d.id === id)).filter(Boolean));
  const availableDocs = $derived(docs.filter((d) => !(activeProject?.docs || []).includes(d.id)));
  const availableVideos = $derived(videos.filter((d) => !(activeProject?.videos || []).includes(d.id)));
  const availableSets = $derived(decks.filter((name) => !(activeProject?.sets || []).includes(name)));
  const availableImages = $derived(captures.filter((c) => c.projectId !== activeProject?.id));
  const captureById = $derived(new Map(projectCaptures.map((c) => [c.id, c])));
  const plan = $derived(composerPlan(activeProject, captures));

  // Channel videos & study list
  const channelVideos = $derived(activeProject?.channelVideos || []);
  const filteredChannelVideos = $derived(
    channelVideos.filter((v) => !channelSearchQuery.trim() || (v.title || '').toLowerCase().includes(channelSearchQuery.trim().toLowerCase()))
  );
  const studyListVideos = $derived(channelVideos.filter((v) => v.inStudyList));

  async function fetchChannelData(channelUrl) {
    const bridge = globalThis.window?.studyos;
    if (typeof bridge?.youtubeChannel === 'function') {
      try {
        const res = await bridge.youtubeChannel({ url: channelUrl, limit: 50 });
        if (res?.ok) return res;
      } catch {}
    }
    try {
      const res = await fetch(`/api/channel?url=${encodeURIComponent(channelUrl)}&limit=50`);
      if (res.ok) {
        const data = await res.json();
        if (data?.ok) return data;
      }
    } catch {}
    return { ok: false, error: 'channelFailed' };
  }

  async function loadChannel() {
    const query = channelInput.trim();
    if (!query) return;
    channelLoading = true;
    channelError = '';
    fetchedChannel = null;
    try {
      const res = await fetchChannelData(query);
      if (res && res.ok && res.channel) {
        fetchedChannel = res;
      } else {
        channelError = tr('projects.channelNotFound');
      }
    } catch (err) {
      channelError = tr('projects.channelNotFound');
    } finally {
      channelLoading = false;
    }
  }

  function createFromFetchedChannel() {
    if (!fetchedChannel?.channel) return;
    onCreateChannelProject?.(fetchedChannel.channel, fetchedChannel.videos || []);
    channelModalOpen = false;
    fetchedChannel = null;
    channelInput = '';
    channelError = '';
  }

  function toggleVideoStudyList(videoId) {
    if (!activeProject) return;
    const next = toggleChannelVideoInStudyList(activeProject, videoId);
    onUpdate(next);
  }

  function toggleAllVideos(enable) {
    if (!activeProject) return;
    const next = setAllChannelVideosInStudyList(activeProject, enable);
    onUpdate(next);
  }

  function countsLabel(project) {
    const c = projectCounts(project, captures, [...docs, ...videos]);
    return tr('projects.cardCounts', { docs: c.docs, videos: c.videos, sets: c.sets, images: c.images });
  }

  function create() {
    const name = newName.trim();
    if (!name) return;
    onCreate(name, newDescription.trim());
    newName = '';
    newDescription = '';
    creating = false;
  }

  function save(patch) {
    if (!activeProject) return;
    onUpdate({ ...activeProject, ...patch });
  }

  function addDoc() {
    if (!docPick) return;
    const next = linkSource(activeProject, 'docs', docPick);
    docPick = '';
    onUpdate(next);
  }

  function addVideo() {
    if (!videoPick) return;
    const next = linkSource(activeProject, 'videos', videoPick);
    videoPick = '';
    onUpdate(next);
  }

  function addSet() {
    if (!setPick) return;
    const next = linkSource(activeProject, 'sets', setPick);
    setPick = '';
    onUpdate(next);
  }

  function addText() {
    const value = newText.trim();
    if (!value) return;
    onUpdate(addComposerText(activeProject, value));
    newText = '';
  }

  function move(entryId, delta) {
    onUpdate(moveComposerEntry(activeProject, entryId, delta));
  }

  function remove(entryId) {
    onUpdate(removeComposerEntry(activeProject, entryId));
  }

  // A text block is rasterized at export time so Arabic joining and mixed
  // digits stay correct; the PDF page is white, so a transparent PNG is enough.
  function textBlockPng(value, width = 1600) {
    const fontSize = 34;
    const lineHeight = 48;
    const padding = 54;
    const maxWidth = width - padding * 2;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const font = `${fontSize}px system-ui, -apple-system, "Segoe UI", "Noto Sans Arabic", sans-serif`;
    ctx.font = font;
    const lines = [];
    for (const paragraph of String(value || '').split(/\r?\n/)) {
      const rtl = /[\u0590-\u08FF]/.test(paragraph);
      let line = '';
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const candidate = line ? `${line} ${word}` : word;
        if (line && ctx.measureText(candidate).width > maxWidth) {
          lines.push({ text: line, rtl });
          line = word;
        } else {
          line = candidate;
        }
      }
      lines.push({ text: line, rtl });
    }
    if (!lines.length) lines.push({ text: '', rtl: false });
    canvas.width = width;
    canvas.height = Math.max(160, Math.round(padding * 2 + lines.length * lineHeight));
    const draw = canvas.getContext('2d');
    draw.clearRect(0, 0, canvas.width, canvas.height);
    draw.font = font;
    draw.fillStyle = '#1b1c25';
    draw.textBaseline = 'top';
    lines.forEach((line, index) => {
      draw.direction = line.rtl ? 'rtl' : 'ltr';
      draw.textAlign = line.rtl ? 'right' : 'left';
      draw.fillText(line.text, line.rtl ? width - padding : padding, padding + index * lineHeight);
    });
    return canvas.toDataURL('image/png');
  }

  async function exportPdf() {
    if (!activeProject || exporting || !plan.length) return;
    exporting = true;
    try {
      const entries = plan.flatMap((item) => {
        if (item.kind === 'text') return [{ image: textBlockPng(item.text), label: '' }];
        const capture = item.capture;
        return [{
          image: capture.image,
          label: item.caption || `${capture.source || ''}${capture.page ? ` · p${capture.page}` : capture.timecode ? ` · ${capture.timecode}` : ''}`
        }];
      });
      const bytes = await imagesToPdf(entries, { labels: true, renderLabelImage: labelPng });
      const res = await deliverBytes(bytes, `${safeBaseName(activeProject.name, 'project')} — project.pdf`, window.studyos || null);
      onExported?.();
      notify?.(res.where === 'file'
        ? tr('toast.exportedTo', { path: res.path })
        : tr('toast.downloaded', { path: res.path }), 'ok');
    } catch (e) {
      notify?.(tr('toast.exportFailed', { message: e.message }), 'error');
    } finally {
      exporting = false;
    }
  }
</script>

{#if !activeProject}
  <div class="section-head">
    <h2 style="margin:0">{tr('nav.projects')}</h2>
    <div class="hstack" style="gap:8px">
      <button class="primary" onclick={() => (channelModalOpen = true)}>
        <Icon name="play" size={14} /><span>{tr('projects.importChannel')}</span>
      </button>
      <button onclick={() => (creating = !creating)}>
        <Icon name="plus" size={14} /><span>{tr('projects.new')}</span>
      </button>
    </div>
  </div>
  <p class="muted project-intro">{tr('projects.intro')}</p>

  {#if creating}
    <div class="card project-create">
      <div class="section-title" style="margin-top:0">{tr('projects.new')}</div>
      <input type="text" bind:value={newName} placeholder={tr('projects.namePlaceholder')} maxlength="80"
        onkeydown={(e) => e.key === 'Enter' && create()} />
      <textarea bind:value={newDescription} placeholder={tr('projects.descriptionPlaceholder')}
        maxlength="600" rows="3"></textarea>
      <div class="hstack">
        <button class="primary" onclick={create} disabled={!newName.trim()}>{tr('common.create')}</button>
        <button onclick={() => (creating = false)}>{tr('common.cancel')}</button>
      </div>
    </div>
  {/if}

  {#if projects.length === 0}
    <div class="empty-state mt">
      <span class="es-icon"><Icon name="projects" size={30} /></span>
      <div class="es-title">{tr('projects.emptyTitle')}</div>
      <p class="es-hint">{tr('projects.emptyHint')}</p>
      <div class="es-actions hstack" style="gap:8px">
        <button class="primary" onclick={() => (channelModalOpen = true)}>
          <Icon name="play" size={14} /><span>{tr('projects.importChannel')}</span>
        </button>
        <button onclick={() => (creating = true)}>{tr('projects.new')}</button>
      </div>
    </div>
  {:else}
    <div class="project-grid mt">
      {#each projects as project (project.id)}
        <div class="project-card">
          <button class="project-card-hit" onclick={() => onSelect(project.id)}
            title={tr('projects.open')}>
            <span class="project-card-head">
              {#if project.channel?.avatar}
                <img src={project.channel.avatar} alt="Avatar" class="project-card-avatar" />
              {:else}
                <span class="project-ico"><Icon name="projects" size={18} /></span>
              {/if}
              <span class="grow">
                <span class="title">{project.name}</span>
                <span class="meta">{project.description || tr('projects.noDescription')}</span>
              </span>
              {#if project.channel}
                <span class="badge channel-badge"><Icon name="play" size={10} /><span>YouTube</span></span>
              {/if}
            </span>
            <span class="project-counts">{countsLabel(project)}</span>
          </button>
          <div class="hstack project-card-actions">
            <button onclick={() => onSelect(project.id)}>{tr('projects.open')}</button>
            <button class="danger-text" onclick={() => onDelete(project.id)}>
              <Icon name="trash" size={13} /><span>{tr('common.delete')}</span>
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
{:else}
  {#key activeProject.id}
    <div class="section-head project-head">
      <button onclick={onBack} title={tr('projects.back')} aria-label={tr('projects.back')}>
        <Icon name="chevron-left" size={16} /><span>{tr('projects.all')}</span>
      </button>
      <div class="grow">
        <h2 style="margin:0">{activeProject.name}</h2>
        <div class="meta">{tr('projects.updated', { when: new Date(activeProject.updatedAt).toLocaleDateString() })}</div>
      </div>
      <span class="badge">{tr('projects.imagesCount', { n: counts.images })}</span>
    </div>

    <div class="project-meta-row">
      <span class="project-chip"><Icon name="reader" size={13} /> {tr('projects.pdfCount', { n: counts.docs })}</span>
      <span class="project-chip"><Icon name="video" size={13} /> {tr('projects.videoCount', { n: counts.videos })}</span>
      <span class="project-chip"><Icon name="flashcards" size={13} /> {tr('projects.setCount', { n: counts.sets })}</span>
      <span class="project-chip"><Icon name="gallery" size={13} /> {tr('projects.imageCount', { n: counts.images })}</span>
      <span class="project-chip"><Icon name="scroll" size={13} /> {tr('projects.blockCount', { n: counts.blocks })}</span>
    </div>

    <div class="card mt">
      <div class="section-title" style="margin-top:0">{tr('projects.details')}</div>
      <label class="field-label">{tr('projects.name')}
        <input type="text" value={activeProject.name} maxlength="80"
          onchange={(e) => save({ name: e.currentTarget.value.trim() || activeProject.name })} />
      </label>
      <label class="field-label">{tr('projects.description')}
        <textarea rows="2" maxlength="600" value={activeProject.description}
          placeholder={tr('projects.descriptionPlaceholder')}
          onchange={(e) => save({ description: e.currentTarget.value })}></textarea>
      </label>
      <p class="muted project-help">{tr('projects.descriptionHelp')}</p>
    </div>

    <!-- YouTube Channel & Study List Section -->
    {#if activeProject.channel || (activeProject.channelVideos && activeProject.channelVideos.length)}
      <div class="card channel-card mt">
        <div class="channel-card-head hstack" style="gap:14px; align-items:center;">
          {#if activeProject.channel?.avatar}
            <img src={activeProject.channel.avatar} alt="Channel avatar" class="channel-avatar-img" />
          {:else}
            <div class="channel-avatar-ico"><Icon name="video" size={24} /></div>
          {/if}
          <div class="grow">
            <div class="hstack" style="gap:8px; align-items:center;">
              <h3 style="margin:0;">{activeProject.channel?.title || activeProject.name}</h3>
              <span class="badge channel-badge"><Icon name="play" size={10} /><span>YouTube</span></span>
            </div>
            {#if activeProject.channel?.description}
              <p class="muted" style="margin:4px 0 0 0; font-size:12px; line-height:1.4;">
                {activeProject.channel.description}
              </p>
            {/if}
            <div class="channel-meta-stats hstack mt" style="gap:12px; font-size:12px;">
              <span class="muted">{channelVideos.length} {tr('projects.videoCount', { n: channelVideos.length })}</span>
              <span class="badge study-count-badge">
                <Icon name="check" size={11} />
                <span>{studyListVideos.length} {tr('projects.inStudyList')}</span>
              </span>
            </div>
          </div>
          {#if activeProject.channel?.url}
            <a href={activeProject.channel.url} target="_blank" rel="noopener noreferrer" class="button small" title={tr('projects.viewOnYoutube')}>
              <Icon name="play" size={13} /><span>{tr('projects.viewOnYoutube')}</span>
            </a>
          {/if}
        </div>

        <!-- Filter & Actions Toolbar -->
        <div class="channel-actions-bar hstack mt" style="justify-content:space-between; gap:10px;">
          <div class="search-wrap hstack grow" style="max-width:320px;">
            <Icon name="search" size={14} />
            <input
              type="search"
              placeholder={tr('projects.searchVideos')}
              bind:value={channelSearchQuery}
              class="channel-search-box grow"
            />
          </div>
          <div class="hstack" style="gap:6px;">
            <button class="small" onclick={() => toggleAllVideos(true)} title={tr('projects.selectAllVideos')}>
              <Icon name="check" size={13} /><span>{tr('projects.selectAllVideos')}</span>
            </button>
            <button class="small" onclick={() => toggleAllVideos(false)} title={tr('projects.deselectAllVideos')}>
              <Icon name="x" size={13} /><span>{tr('projects.deselectAllVideos')}</span>
            </button>
          </div>
        </div>

        <!-- Video Cards Grid -->
        {#if filteredChannelVideos.length === 0}
          <div class="empty muted mt" style="text-align:center; padding:24px;">
            {tr('projects.noVideosMatch')}
          </div>
        {:else}
          <div class="channel-videos-grid mt">
            {#each filteredChannelVideos as v (v.id)}
              <div class="channel-video-item {v.inStudyList ? 'in-study' : ''}">
                <div class="video-preview-box">
                  <img src={v.thumbnail || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`} alt={v.title} class="v-thumb" loading="lazy" />
                  {#if v.duration > 0}
                    <span class="duration-pill">{formatTimecode(v.duration)}</span>
                  {/if}
                  <button
                    class="play-overlay"
                    onclick={() => onPlayChannelVideo?.(v, activeProject)}
                    title={tr('projects.playVideo')}
                  >
                    <Icon name="play" size={26} />
                  </button>
                </div>
                <div class="video-content">
                  <div class="v-title" title={v.title}>{v.title}</div>
                  <div class="v-btn-row hstack mt" style="justify-content:space-between;">
                    <button
                      class="small {v.inStudyList ? 'primary' : ''}"
                      onclick={() => toggleVideoStudyList(v.id)}
                      title={v.inStudyList ? tr('projects.removeFromStudyList') : tr('projects.addToStudyList')}
                    >
                      <Icon name={v.inStudyList ? 'check' : 'plus'} size={12} />
                      <span>{v.inStudyList ? tr('projects.inStudyList') : tr('projects.addToStudyList')}</span>
                    </button>
                    <button
                      class="small"
                      onclick={() => onPlayChannelVideo?.(v, activeProject)}
                      title={tr('projects.playVideo')}
                    >
                      <Icon name="play" size={12} />
                      <span>{tr('projects.openSource')}</span>
                    </button>
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Folders & Resources Section -->
    <div class="card mt folders-card">
      <div class="hstack" style="justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
        <div class="hstack" style="gap:8px; align-items:center;">
          <Icon name="folder" size={20} />
          <div class="section-title" style="margin:0">{tr('projects.folders')} ({projectFolders.length})</div>
        </div>
        <button class="primary small" onclick={() => (creatingFolder = true)}>
          <Icon name="folderPlus" size={15} /><span>{tr('projects.addFolder')}</span>
        </button>
      </div>

      {#if creatingFolder}
        <div class="create-folder-panel mt">
          <div class="hstack" style="gap:8px; flex-wrap:wrap;">
            <input
              type="text"
              placeholder={tr('projects.folderNamePlaceholder')}
              bind:value={newFolderName}
              class="grow"
              onkeydown={(e) => e.key === 'Enter' && handleCreateFolder()}
            />
            <input type="color" bind:value={newFolderColor} title="Folder Color" style="width:40px; height:34px; padding:2px; border-radius:6px; cursor:pointer;" />
            <button class="primary small" onclick={handleCreateFolder} disabled={!newFolderName.trim()}>
              <Icon name="check" size={14} /><span>{tr('projects.createFolder')}</span>
            </button>
            <button class="small" onclick={() => { creatingFolder = false; newFolderName = ''; }}>
              <Icon name="x" size={14} /><span>{tr('video.discard')}</span>
            </button>
          </div>
        </div>
      {/if}

      {#if projectFolders.length === 0}
        <div class="empty muted mt" style="padding:24px; text-align:center;">
          {tr('projects.noFolderItems')}
        </div>
      {:else}
        <div class="folders-grid mt">
          {#each projectFolders as folder (folder.id)}
            {@const isCollapsed = collapsedFolders.has(folder.id)}
            <div class="folder-block" style="--folder-clr:{folder.color || '#3b82f6'};">
              <div class="folder-head hstack" style="justify-content:space-between; align-items:center;">
                <button class="folder-title-btn hstack grow" onclick={() => toggleFolder(folder.id)}>
                  <Icon name={isCollapsed ? 'chevron-right' : 'chevron-down'} size={15} />
                  <span class="folder-icon" style="color:{folder.color || '#3b82f6'};"><Icon name="folder" size={18} /></span>
                  <span class="folder-name">{folder.name}</span>
                  <span class="badge" style="font-size:11px;">{folder.items?.length || 0}</span>
                </button>
                <div class="hstack" style="gap:4px;">
                  <button class="small" onclick={() => (activeFolderForAdd = activeFolderForAdd === folder.id ? null : folder.id)} title={tr('projects.addResource')}>
                    <Icon name="plus" size={13} /><span>{tr('projects.addResource')}</span>
                  </button>
                  <button class="icon-btn" onclick={() => handleDeleteFolder(folder.id)} title={tr('projects.deleteFolder')}>
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </div>

              {#if activeFolderForAdd === folder.id}
                <div class="add-resource-panel">
                  <div class="hstack" style="justify-content:space-between; align-items:center; margin-bottom:10px;">
                    <div class="hstack" style="gap:6px; align-items:center; font-weight:600; font-size:13px;">
                      <Icon name="link" size={15} />
                      <span>{tr('projects.addExistingResource')} ({folder.name})</span>
                    </div>
                    <button class="icon-btn" onclick={() => (activeFolderForAdd = null)} aria-label={tr('common.cancel')}>
                      <Icon name="x" size={14} />
                    </button>
                  </div>

                  <!-- Type Selector Tabs -->
                  <div class="hstack" style="gap:6px; margin-bottom:10px; flex-wrap:wrap;">
                    <button class="small {addResourceType === 'all' ? 'primary' : ''}" onclick={() => addResourceType = 'all'}>
                      <span>{tr('projects.allResources')} ({allExistingResources.length})</span>
                    </button>
                    <button class="small {addResourceType === 'video' ? 'primary' : ''}" onclick={() => addResourceType = 'video'}>
                      <Icon name="play" size={12} /><span>{tr('projects.resourceVideo')} ({videos.length})</span>
                    </button>
                    <button class="small {addResourceType === 'pdf' ? 'primary' : ''}" onclick={() => addResourceType = 'pdf'}>
                      <Icon name="reader" size={12} /><span>{tr('projects.resourcePdf')} ({docs.length})</span>
                    </button>
                    <button class="small {addResourceType === 'deck' ? 'primary' : ''}" onclick={() => addResourceType = 'deck'}>
                      <Icon name="flashcards" size={12} /><span>{tr('projects.resourceDeck')} ({decks.length})</span>
                    </button>
                    <button class="small {addResourceType === 'image' ? 'primary' : ''}" onclick={() => addResourceType = 'image'}>
                      <Icon name="gallery" size={12} /><span>{tr('projects.resourceImage')} ({captures.length})</span>
                    </button>
                    <button class="small {addResourceType === 'youtube' ? 'primary' : ''}" onclick={() => addResourceType = 'youtube'}>
                      <Icon name="link" size={12} /><span>{tr('projects.newYoutubeLink')}</span>
                    </button>
                  </div>

                  {#if addResourceType === 'youtube'}
                    <div class="hstack" style="gap:8px; flex-wrap:wrap;">
                      <input type="text" placeholder={tr('projects.youtubePlaceholder')} bind:value={addYoutubeUrl} class="grow" />
                      <input type="text" placeholder={tr('projects.resourceTitlePlaceholder')} bind:value={addResourceTitle} style="max-width:200px;" />
                      <button class="primary small" onclick={() => handleAddCustomYoutube(folder.id)} disabled={!addYoutubeUrl.trim()}>
                        <Icon name="plus" size={13} /><span>{tr('common.add')}</span>
                      </button>
                    </div>
                  {:else}
                    <!-- Search Input -->
                    <div class="hstack" style="margin-bottom:10px;">
                      <input
                        type="text"
                        placeholder={tr('projects.searchExisting')}
                        bind:value={resourceSearchQuery}
                        class="grow"
                        style="font-size:13px; padding:6px 10px;"
                      />
                    </div>

                    <!-- Existing Resources List -->
                    <div class="existing-resources-picker-list">
                      {#if filteredExistingResources.length === 0}
                        <div class="muted" style="padding:14px; text-align:center; font-size:12px;">
                          {tr('projects.noVideosMatch') || 'No resources found'}
                        </div>
                      {:else}
                        {#each filteredExistingResources as res (res.id || `${res.type}-${res.refId}`)}
                          {@const inFolder = isItemInActiveFolder(res)}
                          <div class="existing-resource-item-row hstack" style="justify-content:space-between; align-items:center;">
                            <div class="hstack" style="gap:8px; align-items:center; overflow:hidden; min-width:0; flex:1;">
                              <span class="resource-badge {res.type}">
                                {#if res.type === 'pdf'}<Icon name="reader" size={13} />
                                {:else if res.type === 'video'}<Icon name="play" size={13} />
                                {:else if res.type === 'deck'}<Icon name="flashcards" size={13} />
                                {:else if res.type === 'image'}<Icon name="gallery" size={13} />{/if}
                              </span>
                              <div class="grow" style="overflow:hidden; min-width:0;">
                                <div class="existing-item-name" title={res.title}>{res.title}</div>
                                <div class="muted" style="font-size:11px;">{res.sub}</div>
                              </div>
                            </div>
                            <div style="flex-shrink:0;">
                              {#if inFolder}
                                <button class="small" style="color:var(--danger, #ef4444); border-color:var(--danger, #ef4444);" onclick={() => handleToggleExistingItem(folder.id, res)}>
                                  <Icon name="check" size={12} /><span>{tr('projects.added')}</span>
                                </button>
                              {:else}
                                <button class="primary small" onclick={() => handleToggleExistingItem(folder.id, res)}>
                                  <Icon name="plus" size={12} /><span>{tr('common.add')}</span>
                                </button>
                              {/if}
                            </div>
                          </div>
                        {/each}
                      {/if}
                    </div>
                  {/if}
                </div>
              {/if}

              {#if !isCollapsed}
                <div class="folder-items-list">
                  {#if !folder.items || folder.items.length === 0}
                    <div class="empty-folder-hint muted">{tr('projects.noFolderItems')}</div>
                  {:else}
                    {#each folder.items as item (item.id)}
                      <div class="folder-item-row hstack" style="justify-content:space-between; align-items:center;">
                        <button class="folder-item-click hstack grow" onclick={() => openFolderResource(item)}>
                          <span class="resource-badge {item.type}">
                            {#if item.type === 'pdf'}<Icon name="reader" size={14} />
                            {:else if item.type === 'video' || item.type === 'youtube'}<Icon name="play" size={14} />
                            {:else if item.type === 'deck'}<Icon name="flashcards" size={14} />
                            {:else if item.type === 'image'}<Icon name="gallery" size={14} />
                            {:else}<Icon name="link" size={14} />{/if}
                          </span>
                          <div class="item-info grow" style="text-align:start;">
                            <div class="item-title">{item.title}</div>
                            <div class="item-meta muted" style="font-size:11px;">{item.type.toUpperCase()}</div>
                          </div>
                          <span class="action-tag">{tr('projects.openSource')}</span>
                        </button>
                        <button class="icon-btn" onclick={() => handleRemoveResource(folder.id, item.id)} title={tr('projects.unlink')}>
                          <Icon name="x" size={13} />
                        </button>
                      </div>
                    {/each}
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="project-cols mt">
      <div class="card">
        <div class="hstack" style="justify-content:space-between; align-items:center;">
          <div class="section-title" style="margin:0">{tr('projects.sources')}</div>
          {#if !activeProject.channel}
            <button class="small" onclick={() => (channelModalOpen = true)}>
              <Icon name="play" size={13} /><span>{tr('projects.importChannel')}</span>
            </button>
          {/if}
        </div>
        <p class="muted project-help">{tr('projects.sourcesHelp')}</p>

        {#each linkedDocs as d (d.id)}
          <div class="project-source">
            <span class="row-ico"><Icon name="reader" size={15} /></span>
            <div class="grow"><div class="title">{d.title}</div><div class="meta">{tr('library.badgePdf')}</div></div>
            <button onclick={() => onOpenSource('pdf', d.id)}>{tr('projects.openSource')}</button>
            <button class="icon-btn" onclick={() => onUpdate(unlinkSource(activeProject, 'docs', d.id))}
              title={tr('projects.unlink')} aria-label={tr('projects.unlink')}><Icon name="x" size={13} /></button>
          </div>
        {/each}
        {#if availableDocs.length}
          <div class="inline-panel">
            <select bind:value={docPick} aria-label={tr('projects.addPdf')}>
              <option value="">{tr('projects.addPdf')}</option>
              {#each availableDocs as d (d.id)}<option value={d.id}>{d.title}</option>{/each}
            </select>
            <button onclick={addDoc} disabled={!docPick}><Icon name="plus" size={14} /><span>{tr('common.add')}</span></button>
          </div>
        {/if}

        {#each linkedVideos as v (v.id)}
          <div class="project-source">
            <span class="row-ico"><Icon name="video" size={15} /></span>
            <div class="grow"><div class="title">{v.title}</div><div class="meta">{tr('library.badgeVideo')}</div></div>
            <button onclick={() => onOpenSource('video', v.id)}>{tr('projects.openSource')}</button>
            <button class="icon-btn" onclick={() => onUpdate(unlinkSource(activeProject, 'videos', v.id))}
              title={tr('projects.unlink')} aria-label={tr('projects.unlink')}><Icon name="x" size={13} /></button>
          </div>
        {/each}
        {#if availableVideos.length}
          <div class="inline-panel">
            <select bind:value={videoPick} aria-label={tr('projects.addVideo')}>
              <option value="">{tr('projects.addVideo')}</option>
              {#each availableVideos as v (v.id)}<option value={v.id}>{v.title}</option>{/each}
            </select>
            <button onclick={addVideo} disabled={!videoPick}><Icon name="plus" size={14} /><span>{tr('common.add')}</span></button>
          </div>
        {/if}

        <div class="project-subtitle">{tr('projects.sets')}</div>
        {#each activeProject.sets as name (name)}
          <div class="project-source">
            <span class="row-ico"><Icon name="flashcards" size={15} /></span>
            <div class="grow"><div class="title">{name}</div><div class="meta">{tr('projects.setLinked')}</div></div>
            <button onclick={() => onOpenSet(name)}>{tr('projects.openSet')}</button>
            <button class="icon-btn" onclick={() => onUpdate(unlinkSource(activeProject, 'sets', name))}
              title={tr('projects.unlink')} aria-label={tr('projects.unlink')}><Icon name="x" size={13} /></button>
          </div>
        {/each}
        {#if availableSets.length}
          <div class="inline-panel">
            <select bind:value={setPick} aria-label={tr('projects.addSet')}>
              <option value="">{tr('projects.addSet')}</option>
              {#each availableSets as name (name)}<option value={name}>{name}</option>{/each}
            </select>
            <button onclick={addSet} disabled={!setPick}><Icon name="plus" size={14} /><span>{tr('common.add')}</span></button>
          </div>
        {/if}
      </div>

      <div class="card">
        <div class="section-head" style="margin:0">
          <div>
            <div class="section-title" style="margin-top:0">{tr('projects.images')}</div>
            <p class="muted project-help" style="margin-bottom:0">{tr('projects.imagesHelp')}</p>
          </div>
          <button onclick={() => onUpdate(addAllProjectImages(activeProject, projectCaptures))} disabled={!projectCaptures.length}>
            <Icon name="plus" size={14} /><span>{tr('projects.addAllImages')}</span>
          </button>
        </div>
        {#if projectCaptures.length === 0}
          <div class="empty project-empty">{tr('projects.noImages')}</div>
        {:else}
          <div class="project-images">
            {#each projectCaptures as c (c.id)}
              <figure class="project-image">
                <img src={c.image} alt={c.name} />
                <figcaption>
                  <span class="title">{c.name}</span>
                  <span class="meta">{c.source}{c.page ? ` · ${tr('common.pageShort')}${c.page}` : c.timecode ? ` · ${c.timecode}` : ''}</span>
                  <span class="hstack">
                    <button onclick={() => onUpdate(addComposerImage(activeProject, c.id, c.name))}>{tr('projects.addToPdf')}</button>
                    <button class="icon-btn" onclick={() => onUnassignCapture(c.id)} title={tr('projects.removeImage')} aria-label={tr('projects.removeImage')}><Icon name="x" size={12} /></button>
                  </span>
                </figcaption>
              </figure>
            {/each}
          </div>
        {/if}

        {#if availableImages.length}
          <div class="inline-panel" style="margin-top:12px">
            <select bind:value={imagePick} aria-label={tr('projects.addFromGallery')}>
              <option value="">{tr('projects.addFromGallery')}</option>
              {#each availableImages.slice(0, 30) as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
            </select>
            <button onclick={() => { if (imagePick) { onAssignCapture(imagePick); imagePick = ''; } }} disabled={!imagePick}>
              <Icon name="plus" size={14} /><span>{tr('common.add')}</span>
            </button>
          </div>
        {/if}
      </div>
    </div>

    <div class="card mt">
      <div class="section-head" style="margin:0">
        <div>
          <div class="section-title" style="margin-top:0">{tr('projects.pdfDraft')}</div>
          <p class="muted project-help" style="margin-bottom:0">{tr('projects.pdfDraftHelp')}</p>
        </div>
        <div class="hstack">
          {#if plan.length}
            <button class="icon-btn" onclick={() => onUpdate(clearComposer(activeProject))} title={tr('projects.clearDraft')} aria-label={tr('projects.clearDraft')}><Icon name="trash" size={14} /></button>
          {/if}
          <button class="primary" onclick={exportPdf} disabled={!plan.length || exporting}>
            <Icon name="download" size={15} /><span>{exporting ? tr('common.exporting') : tr('projects.exportPdf')}</span>
          </button>
        </div>
      </div>

      {#if plan.length === 0}
        <div class="empty project-empty">{tr('projects.noDraft')}</div>
      {:else}
        <div class="composer-list">
          {#each plan as item, index (item.id)}
            <div class="composer-row">
              <span class="composer-index">{index + 1}</span>
              {#if item.kind === 'image'}
                <img class="composer-thumb" src={item.capture.image} alt="" />
                <div class="grow">
                  <div class="title">{item.capture.name}</div>
                  <input type="text" value={item.caption} maxlength="240"
                    placeholder={tr('projects.captionPlaceholder')}
                    onchange={(e) => onUpdate(updateComposerEntry(activeProject, item.id, { caption: e.currentTarget.value }))} />
                </div>
              {:else}
                <div class="composer-text grow">
                  <textarea rows="2" value={item.text} maxlength="4000"
                    onchange={(e) => onUpdate(updateComposerEntry(activeProject, item.id, { text: e.currentTarget.value }))}></textarea>
                </div>
              {/if}
              <div class="composer-actions">
                <button class="icon-btn" onclick={() => move(item.id, -1)} disabled={index === 0}
                  title={tr('projects.moveUp')} aria-label={tr('projects.moveUp')}><Icon name="chevron-up" size={14} /></button>
                <button class="icon-btn" onclick={() => move(item.id, 1)} disabled={index === plan.length - 1}
                  title={tr('projects.moveDown')} aria-label={tr('projects.moveDown')}><Icon name="chevron-down" size={14} /></button>
                <button class="icon-btn" onclick={() => remove(item.id)}
                  title={tr('common.remove')} aria-label={tr('common.remove')}><Icon name="x" size={14} /></button>
              </div>
            </div>
          {/each}
        </div>
      {/if}

      <div class="composer-add-text">
        <textarea rows="2" bind:value={newText} maxlength="4000"
          placeholder={tr('projects.textPlaceholder')}></textarea>
        <button onclick={addText} disabled={!newText.trim()}>
          <Icon name="text" size={14} /><span>{tr('projects.addText')}</span>
        </button>
      </div>
      <p class="muted project-help">{tr('projects.composerHelp')}</p>
    </div>
  {/key}
{/if}

<!-- Import YouTube Channel as Project Modal -->
{#if channelModalOpen}
  <div class="modal-backdrop" onclick={() => (channelModalOpen = false)} role="presentation">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="channel-import-modal card" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
      <div class="section-head" style="margin-top:0">
        <h3 style="margin:0"><Icon name="play" size={16} /> <span>{tr('projects.importChannel')}</span></h3>
        <button class="icon-btn" onclick={() => (channelModalOpen = false)} aria-label={tr('common.cancel')}>
          <Icon name="x" size={14} />
        </button>
      </div>

      <p class="muted" style="margin:6px 0 14px 0; font-size:13px;">
        {tr('projects.sourcesHelp')}
      </p>

      <form onsubmit={(e) => { e.preventDefault(); loadChannel(); }} class="channel-form-row hstack" style="gap:8px;">
        <input
          type="text"
          placeholder={tr('projects.channelUrlPlaceholder')}
          bind:value={channelInput}
          class="grow"
          disabled={channelLoading}
        />
        <button type="submit" class="primary" disabled={channelLoading || !channelInput.trim()}>
          {#if channelLoading}
            <span>{tr('projects.fetchingChannel')}</span>
          {:else}
            <Icon name="search" size={14} /><span>{tr('projects.fetchChannel')}</span>
          {/if}
        </button>
      </form>

      {#if channelError}
        <div class="empty error-box mt" style="padding:10px 14px; color:var(--danger, #ef4444); border:1px solid var(--danger, #ef4444); border-radius:8px;">
          <Icon name="alert" size={14} />
          <span>{channelError}</span>
        </div>
      {/if}

      {#if fetchedChannel}
        <div class="channel-preview-card card mt" style="background:var(--surface-2, rgba(0,0,0,0.03)); border:1px solid var(--border);">
          <div class="hstack" style="gap:12px; align-items:center;">
            {#if fetchedChannel.channel.avatar}
              <img src={fetchedChannel.channel.avatar} alt="Avatar" class="channel-avatar-img" />
            {:else}
              <div class="channel-avatar-ico"><Icon name="video" size={24} /></div>
            {/if}
            <div class="grow">
              <h4 style="margin:0;">{fetchedChannel.channel.title}</h4>
              <div class="meta" style="font-size:12px;">{fetchedChannel.videos.length} {tr('projects.videoCount', { n: fetchedChannel.videos.length })}</div>
            </div>
          </div>
          {#if fetchedChannel.channel.description}
            <p class="muted mt" style="font-size:12px; line-height:1.4; max-height:80px; overflow:hidden; text-overflow:ellipsis;">
              {fetchedChannel.channel.description}
            </p>
          {/if}
          <div class="hstack mt" style="justify-content:flex-end; gap:8px;">
            <button onclick={() => (channelModalOpen = false)}>{tr('common.cancel')}</button>
            <button class="primary" onclick={createFromFetchedChannel}>
              <Icon name="plus" size={14} /><span>{tr('projects.createChannelProject')}</span>
            </button>
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}
