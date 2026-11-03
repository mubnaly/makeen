<script>
  // Planner (plan §6.8): tasks, study blocks, calendar views and recurrence.
  // - Month / Week / Day / List views over the same task records.
  // - Study blocks are tasks with startTime + durationMinutes + resource links
  //   (e.g. "Biology.pdf pages 10-20, every day 15:00-15:50").
  // - Recurring tasks complete per-occurrence; series edits are explicit.
  // - Reminders ask permission only on first enable and persist notified dates
  //   so restarts do not re-notify. Honest limitation: they only fire while the
  //   app is open.
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { putTask, deleteTaskById, listTasks } from '../lib/storage.js';
  import {
    makeRule, validateRule, occursOn, occurrencesInRange,
    todayIso, addDays, dayOfWeek, parseDate
  } from '../lib/recurrence.js';
  // `t` is a task variable in this file's markup, so the translator is `tr`.
  import { t as tr, ui } from '../lib/lang.svelte.js';
  import { describeRuleText, formatDate, formatMonth, weekdayShort } from '../lib/i18n.js';

  let { notify, docs = [], onOpenResource } = $props();

  const PRIORITIES = ['low', 'normal', 'high'];
  const PRIORITY_LABEL = { low: 'planner.priorityLow', normal: 'planner.priorityNormal', high: 'planner.priorityHigh' };
  const VIEWS = [
    { id: 'month', label: 'planner.viewMonth' },
    { id: 'week', label: 'planner.viewWeek' },
    { id: 'day', label: 'planner.viewDay' },
    { id: 'list', label: 'planner.viewList' }
  ];
  const HOURS = Array.from({ length: 24 }, (_, i) => i);

  let tasks = $state([]);
  let view = $state('week'); // plan §6.8: week grid is the desktop default (day agenda on mobile)
  let anchor = $state(todayIso()); // focused date for month/week/day views
  let editing = $state(null); // task draft or null
  let remindersOn = $state(false);
  let reminderTimer = null;
  let linkSelect = $state();
  let linkPage = $state();
  let checkInput = $state();

  // Month grid runs Sunday-first (matches dayOfWeek 0 = Sunday); the header row
  // follows the app language through Intl.
  const dayLabels = $derived(Array.from({ length: 7 }, (_, i) => weekdayShort(ui.lang, i)));
  const anchorDate = $derived(parseDate(anchor));
  const monthLabel = $derived(formatMonth(ui.lang, anchor));
  const weekStart = $derived(addDays(anchor, -dayOfWeek(anchor)));
  const weekLabel = $derived(formatDate(ui.lang, weekStart, { day: 'numeric', month: 'long' }));
  const dayLabel = $derived(formatDate(ui.lang, anchor));

  const monthDays = $derived.by(() => {
    const first = `${anchor.slice(0, 8)}01`;
    const start = addDays(first, -dayOfWeek(first));
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  });
  const weekDays = $derived(Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)));

  const openTasks = $derived(tasks.filter((task) => !isDoneOn(task, todayIso())));
  const overdueTasks = $derived(tasks.filter((task) => !task.recurrence && task.status !== 'done' && task.dueDate && task.dueDate < todayIso()));

  onMount(async () => {
    tasks = await listTasks();
    remindersOn = localStorage.getItem('studyos.reminders') === '1';
    if (window.matchMedia('(max-width: 720px)').matches) view = 'day';
    startReminderLoop();
    return () => stopReminderLoop();
  });

  // --- occurrence model ------------------------------------------------------

  function seriesStartOf(task) {
    return task.dueDate || (task.createdAt || '').slice(0, 10) || todayIso();
  }
  function taskOccursOn(task, iso) {
    if (task.recurrence) return occursOn(task.recurrence, seriesStartOf(task), iso);
    return task.dueDate === iso;
  }
  function isDoneOn(task, iso) {
    if (task.recurrence) return (task.completedOccurrences || []).includes(iso);
    return task.status === 'done';
  }
  function tasksForDay(iso) {
    return tasks
      .filter((task) => taskOccursOn(task, iso))
      .sort((a, b) => (a.startTime || 'zz').localeCompare(b.startTime || 'zz'));
  }
  function doneTodayCount(iso) {
    return tasksForDay(iso).filter((task) => isDoneOn(task, iso)).length;
  }
  const ruleText = (rule) => describeRuleText(ui.lang, rule, tr);

  // --- persistence -----------------------------------------------------------

  async function refresh() {
    tasks = await listTasks();
  }
  async function saveTask(draft) {
    if (!draft.title.trim()) { notify(tr('toast.titleRequired'), 'error'); return; }
    if (draft.recurrence) {
      const check = validateRule(draft.recurrence);
      if (!check.ok) { notify(tr('toast.ruleInvalid'), 'error'); return; }
    }
    const now = new Date().toISOString();
    const task = { ...draft, id: draft.id || crypto.randomUUID(), title: draft.title.trim(), updatedAt: now, createdAt: draft.createdAt || now };
    await putTask(task);
    editing = null;
    await refresh();
    notify(task.recurrence ? tr('toast.seriesSaved') : tr('toast.taskSaved'), 'ok');
  }
  async function removeTask(task) {
    const label = task.recurrence
      ? tr('toast.confirmDeleteSeries', { title: task.title })
      : tr('toast.confirmDeleteTask', { title: task.title });
    if (!confirm(label)) return;
    await deleteTaskById(task.id);
    editing = null;
    await refresh();
    notify(tr('toast.taskDeleted'), 'ok');
  }
  async function toggleDone(task, iso) {
    if (task.recurrence) {
      const set = new Set(task.completedOccurrences || []);
      if (set.has(iso)) set.delete(iso); else set.add(iso);
      await putTask({ ...task, completedOccurrences: [...set].sort(), updatedAt: new Date().toISOString() });
    } else {
      const done = task.status !== 'done';
      await putTask({ ...task, status: done ? 'done' : 'todo', updatedAt: new Date().toISOString() });
    }
    await refresh();
  }

  // --- drag-to-reschedule ----------------------------------------------------

  function onDragStart(e, task) {
    e.dataTransfer.setData('text/task-id', task.id);
    e.dataTransfer.effectAllowed = 'move';
  }
  async function onDropDay(e, iso) {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/task-id');
    const task = tasks.find((x) => x.id === id);
    if (!task || taskOccursOn(task, iso)) return;
    if (task.recurrence) {
      const ok = confirm(tr('toast.confirmMoveSeries', { title: task.title, rule: ruleText(task.recurrence), date: iso }));
      if (!ok) return;
    }
    await putTask({ ...task, dueDate: iso, updatedAt: new Date().toISOString() });
    await refresh();
    notify(tr('toast.movedTo', { date: iso }), 'ok');
  }

  // --- editor ----------------------------------------------------------------

  function newDraft(date = anchor) {
    return {
      id: crypto.randomUUID(),
      title: '', notes: '', status: 'todo', priority: 'normal',
      estimateMinutes: null, dueDate: date, startTime: null, durationMinutes: null,
      recurrence: null, checklist: [], links: [], completedOccurrences: []
    };
  }
  function editTask(task) {
    editing = JSON.parse(JSON.stringify(task)); // deep copy, never a $state proxy
  }
  function addRecurrence() {
    editing.recurrence = makeRule({ freq: 'daily', interval: 1, daysOfWeek: [dayOfWeek(editing.dueDate || todayIso())], dayOfMonth: parseDate(editing.dueDate || todayIso()).getUTCDate() });
  }
  function toggleRecurrenceDay(dow) {
    const days = new Set(editing.recurrence.daysOfWeek || []);
    if (days.has(dow)) days.delete(dow); else days.add(dow);
    editing.recurrence.daysOfWeek = [...days].sort();
  }
  function addChecklistItem(input) {
    const text = input.value.trim();
    if (!text) return;
    editing.checklist = [...editing.checklist, { id: crypto.randomUUID(), text, done: false }];
    input.value = '';
  }
  function removeChecklistItem(id) {
    editing.checklist = editing.checklist.filter((c) => c.id !== id);
  }
  function addLink(select, pageInput) {
    const kind = select.value;
    if (kind === 'deck') {
      editing.links = [...editing.links, { kind: 'deck', title: tr('planner.deckLink') }];
      return;
    }
    const doc = docs.find((d) => d.id === select.value);
    if (!doc) return;
    const page = Math.max(1, parseInt(pageInput.value, 10) || 1);
    editing.links = [...editing.links, { kind: 'pdf', docId: doc.id, title: doc.title, page }];
    select.value = '';
    pageInput.value = '1';
  }
  function removeLink(idx) {
    editing.links = editing.links.filter((_, i) => i !== idx);
  }

  // --- reminders (in-app; fire only while the app is open) -------------------

  function startReminderLoop() {
    stopReminderLoop();
    if (!remindersOn) return;
    checkReminders();
    reminderTimer = setInterval(checkReminders, 30000);
  }
  function stopReminderLoop() {
    if (reminderTimer) clearInterval(reminderTimer);
    reminderTimer = null;
  }
  async function toggleReminders() {
    if (!remindersOn) {
      if ('Notification' in window && Notification.permission !== 'granted') {
        const p = await Notification.requestPermission();
        if (p !== 'granted') { notify(tr('toast.reminderDenied'), 'error'); return; }
      }
      remindersOn = true;
      notify(tr('toast.remindersOn'), 'ok');
    } else {
      remindersOn = false;
      notify(tr('toast.remindersOff'), 'ok');
    }
    localStorage.setItem('studyos.reminders', remindersOn ? '1' : '0');
    startReminderLoop();
  }
  function fireReminder(task) {
    const when = task.startTime
      ? `${tr('toast.blockStarts', { time: task.startTime })}${task.durationMinutes ? ` · ${tr('toast.blockDuration', { n: task.durationMinutes })}` : ''}`
      : tr('toast.dueToday');
    const title = tr('toast.reminderBlockTitle');
    if (window.studyos?.notify) window.studyos.notify(title, `${task.title} — ${when}`);
    else if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body: `${task.title} — ${when}` });
  }
  function checkReminders() {
    if (!remindersOn) return;
    const now = new Date();
    const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const today = todayIso(now);
    for (const task of tasks) {
      if (!task.startTime || task.startTime !== hm) continue;
      if (!taskOccursOn(task, today) || isDoneOn(task, today)) continue;
      if ((task.notifiedDates || []).includes(today)) continue;
      fireReminder(task);
      putTask({ ...task, notifiedDates: [...(task.notifiedDates || []), today] }).then(refresh);
    }
  }

  // --- misc ------------------------------------------------------------------

  function priorityDot(p) {
    return p === 'high' ? 'var(--danger)' : p === 'low' ? 'var(--muted)' : 'var(--accent)';
  }
  function addMinutes(hhmm, minutes) {
    const [h, m] = hhmm.split(':').map(Number);
    const total = h * 60 + m + minutes;
    return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }
  function blockTop(task) {
    const [h, m] = task.startTime.split(':').map(Number);
    return ((h * 60 + m) / 1440) * 1152; // 24h * 48px
  }
  function blockHeight(task) {
    return Math.max(20, ((task.durationMinutes || 30) / 1440) * 1152);
  }
  function shiftPeriod(dir) {
    if (view === 'month') {
      const d = parseDate(anchor);
      anchor = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1 + dir).padStart(2, '0')}-01`;
      // normalize month overflow (e.g. month 13)
      const nd = parseDate(anchor);
      if (Number.isNaN(nd.getTime())) anchor = addDays(anchor, -1);
    } else if (view === 'week') anchor = addDays(anchor, dir * 7);
    else anchor = addDays(anchor, dir);
  }
</script>

<div class="planner">
  <!-- Header -->
  <div class="planner-head">
    <div class="hstack">
      <h2 style="margin:0">{tr('planner.title')}</h2>
      <button onclick={() => shiftPeriod(-1)} title={tr('planner.previous')} aria-label={tr('planner.previous')}><Icon name="chevron-left" /></button>
      <button onclick={() => (anchor = todayIso())}>{tr('planner.today')}</button>
      <button onclick={() => shiftPeriod(1)} title={tr('planner.next')} aria-label={tr('planner.next')}><Icon name="chevron-right" /></button>
      <span class="muted">
        {view === 'month' ? monthLabel : view === 'week' ? tr('planner.weekOf', { date: weekLabel }) : dayLabel}
      </span>
    </div>
    <div class="hstack">
      {#each VIEWS as def}
        <button class={view === def.id ? 'active' : ''} onclick={() => (view = def.id)}>{tr(def.label)}</button>
      {/each}
      <label class="hstack" style="gap:4px; font-size:13px" title={tr('planner.remindersTitle')}>
        <input type="checkbox" checked={remindersOn} onchange={toggleReminders} /> {tr('planner.reminders')}
      </label>
      <button class="primary" onclick={() => (editing = newDraft())}>
        <Icon name="plus" size={15} /><span>{tr('planner.newTask')}</span>
      </button>
    </div>
  </div>

  {#if overdueTasks.length}
    <div class="overdue-banner">
      <Icon name="alert" size={15} />
      <span>{tr('planner.overdue', { n: overdueTasks.length, titles: overdueTasks.map((task) => task.title).join('، ') })}</span>
    </div>
  {/if}

  {#if view === 'month'}
    <!-- Month grid -->
    <div class="month-grid">
      {#each dayLabels as d}<div class="dow">{d}</div>{/each}
      {#each monthDays as iso}
        {@const dayTasks = tasksForDay(iso)}
        <div class="month-cell {iso === todayIso() ? 'today' : ''} {iso.slice(0, 7) !== anchor.slice(0, 7) ? 'faded' : ''}"
          ondragover={(e) => e.preventDefault()} ondrop={(e) => onDropDay(e, iso)}
          onclick={() => { anchor = iso; view = 'day'; }}>
          <div class="cell-date">{Number(iso.slice(8))}</div>
          {#each dayTasks.slice(0, 3) as task}
            <div class="chip {isDoneOn(task, iso) ? 'done' : ''}" draggable="true"
              ondragstart={(e) => onDragStart(e, task)}
              onclick={(e) => { e.stopPropagation(); editTask(task); }}
              title={`${task.title}${task.startTime ? ` · ${task.startTime}` : ''}`}>
              <span class="dot" style="background:{priorityDot(task.priority)}"></span>
              {task.startTime ? `${task.startTime} ` : ''}{task.title}
            </div>
          {/each}
          {#if dayTasks.length > 3}<div class="more">{tr('planner.more', { n: dayTasks.length - 3 })}</div>{/if}
        </div>
      {/each}
    </div>

  {:else if view === 'week'}
    <!-- Week grid -->
    <div class="week-scroll">
      <div class="week-grid">
        <div class="week-corner"></div>
        {#each weekDays as iso, i}
          <div class="week-dayhead {iso === todayIso() ? 'today' : ''}" onclick={() => { anchor = iso; view = 'day'; }}>
            {dayLabels[i]} {Number(iso.slice(8))}
          </div>
        {/each}
        <div class="hour-gutter">
          {#each HOURS as h}<div class="hour-label">{String(h).padStart(2, '0')}</div>{/each}
        </div>
        {#each weekDays as iso}
          <div class="week-col" ondragover={(e) => e.preventDefault()} ondrop={(e) => onDropDay(e, iso)}>
            {#each HOURS as h}<div class="hour-line"></div>{/each}
            {#each tasksForDay(iso).filter((task) => task.startTime) as task}
              <div class="time-block {isDoneOn(task, iso) ? 'done' : ''}" style="top:{blockTop(task)}px; height:{blockHeight(task)}px; border-inline-start-color:{priorityDot(task.priority)}"
                draggable="true" ondragstart={(e) => onDragStart(e, task)} onclick={() => editTask(task)}
                title={`${task.title} · ${task.startTime}`}>
                <div class="tb-title">{task.title}</div>
                <div class="tb-time">{task.startTime} · {task.durationMinutes || 30}{tr('common.minutesShort')}</div>
              </div>
            {/each}
          </div>
        {/each}
      </div>
    </div>

  {:else if view === 'day'}
    <!-- Day agenda -->
    <div class="day-agenda">
      <div class="hstack" style="margin-bottom:10px">
        <input type="date" value={anchor} onchange={(e) => (anchor = e.target.value || anchor)} />
        <span class="muted">{tr('planner.itemsDone', { n: tasksForDay(anchor).length, done: doneTodayCount(anchor) })}</span>
      </div>
      {#if tasksForDay(anchor).length === 0}
        <div class="empty">{tr('planner.nothingPlanned')}</div>
      {/if}
      {#each tasksForDay(anchor) as task (task.id + anchor)}
        <div class="agenda-row {isDoneOn(task, anchor) ? 'done' : ''}">
          <input type="checkbox" checked={isDoneOn(task, anchor)} onchange={() => toggleDone(task, anchor)} />
          <div class="grow">
            <div class="title" style="border-inline-start:3px solid {priorityDot(task.priority)}; padding-inline-start:8px">{task.title}</div>
            {#if task.notes}<div class="muted" style="font-size:12px; padding-inline-start:11px">{task.notes}</div>{/if}
            <div class="row-meta">
              {#if task.startTime}
                <span class="badge"><Icon name="clock" size={12} /> {task.startTime}{task.durationMinutes ? `–${addMinutes(task.startTime, task.durationMinutes)}` : ''}</span>
              {/if}
              {#if task.estimateMinutes}<span class="badge">≈ {task.estimateMinutes}{tr('common.minutesShort')}</span>{/if}
              {#if task.recurrence}<span class="badge"><Icon name="repeat" size={12} /> {ruleText(task.recurrence)}</span>{/if}
              {#if task.checklist.length}
                <span class="badge"><Icon name="check-square" size={12} /> {task.checklist.filter((c) => c.done).length}/{task.checklist.length}</span>
              {/if}
              {#each task.links as link}
                <button class="badge link-chip" onclick={() => onOpenResource?.(link)} title={tr('planner.openResource')}>
                  <Icon name={link.kind === 'pdf' ? 'reader' : 'flashcards'} size={12} />
                  {link.kind === 'pdf' ? `${link.title}${link.page ? ` ${tr('common.pageShort')}.${link.page}` : ''}` : tr('planner.deckLink')}
                </button>
              {/each}
            </div>
            {#if task.checklist.length}
              <div class="mini-check">
                {#each task.checklist as c (c.id)}
                  <label class="hstack" style="gap:6px; font-size:12px">
                    <input type="checkbox" checked={c.done} onchange={() => { c.done = !c.done; putTask(task).then(refresh); }} /> {c.text}
                  </label>
                {/each}
              </div>
            {/if}
          </div>
          <button onclick={() => editTask(task)}>{tr('planner.edit')}</button>
        </div>
      {/each}
    </div>

    {:else}
      <!-- List view -->
      <div class="task-list">
        {#if tasks.length === 0}<div class="empty">{tr('planner.noTasks')}</div>{/if}
        {#each [...tasks].sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999')) as task (task.id)}
          {@const done = isDoneOn(task, todayIso())}
          <div class="agenda-row {done ? 'done' : ''} {task.dueDate && task.dueDate < todayIso() && !task.recurrence && !done ? 'overdue' : ''}">
            <input type="checkbox" checked={done} onchange={() => toggleDone(task, todayIso())} />
            <div class="grow">
              <div class="title" style="border-inline-start:3px solid {priorityDot(task.priority)}; padding-inline-start:8px">{task.title}</div>
              <div class="row-meta">
                {#if task.dueDate}<span class="badge"><Icon name="planner" size={12} /> {task.dueDate}</span>{/if}
                {#if task.startTime}<span class="badge"><Icon name="clock" size={12} /> {task.startTime}</span>{/if}
                {#if task.recurrence}<span class="badge"><Icon name="repeat" size={12} /> {ruleText(task.recurrence)}</span>{/if}
                {#each task.links as link}
                  <button class="badge link-chip" onclick={() => onOpenResource?.(link)}>
                    <Icon name={link.kind === 'pdf' ? 'reader' : 'flashcards'} size={12} />
                    {link.kind === 'pdf' ? `${link.title}${link.page ? ` ${tr('common.pageShort')}.${link.page}` : ''}` : tr('planner.deckLink')}
                  </button>
                {/each}
              </div>
            </div>
            <button onclick={() => editTask(task)}>{tr('planner.edit')}</button>
          </div>
        {/each}
      </div>
    {/if}
</div>

<!-- Editor dialog -->
{#if editing}
  <div class="modal-backdrop" onclick={() => (editing = null)} onkeydown={(e) => e.key === 'Escape' && (editing = null)} role="presentation">
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={editing.createdAt ? tr('planner.editTask') : tr('planner.newTaskTitle')}>
      <h3 style="margin-top:0">{editing.createdAt ? tr('planner.editTask') : tr('planner.newTaskTitle')}</h3>

      <label class="field"><span>{tr('planner.fieldTitle')}</span>
        <input type="text" bind:value={editing.title} placeholder={tr('planner.titlePlaceholder')} />
      </label>
      <label class="field"><span>{tr('planner.notes')}</span>
        <textarea rows="2" bind:value={editing.notes}></textarea>
      </label>

      <div class="field-row">
        <label class="field"><span>{tr('planner.dueDate')}</span><input type="date" bind:value={editing.dueDate} /></label>
        <label class="field"><span>{tr('planner.priority')}</span>
          <select bind:value={editing.priority}>
            {#each PRIORITIES as p}<option value={p}>{tr(PRIORITY_LABEL[p])}</option>{/each}
          </select>
        </label>
        <label class="field"><span>{tr('planner.estimate')}</span><input type="number" min="0" step="5" bind:value={editing.estimateMinutes} /></label>
      </div>

      <div class="section-title">{tr('planner.studyBlock')}</div>
      <div class="field-row">
        <label class="field"><span>{tr('planner.startTime')}</span><input type="time" bind:value={editing.startTime} /></label>
        <label class="field"><span>{tr('planner.duration')}</span><input type="number" min="5" step="5" bind:value={editing.durationMinutes} /></label>
      </div>

      <div class="section-title">{tr('planner.recurrence')}</div>
      {#if !editing.recurrence}
        <button onclick={addRecurrence}><Icon name="repeat" size={15} /><span>{tr('planner.makeRepeating')}</span></button>
      {:else}
        <div class="rec-card">
          <div class="field-row">
            <label class="field"><span>{tr('planner.frequency')}</span>
              <select bind:value={editing.recurrence.freq}>
                <option value="daily">{tr('planner.daily')}</option>
                <option value="weekly">{tr('planner.weekly')}</option>
                <option value="monthly">{tr('planner.monthly')}</option>
              </select>
            </label>
            <label class="field"><span>{tr('planner.every')}</span><input type="number" min="1" max="365" bind:value={editing.recurrence.interval} /> <span>{tr('planner.timesSuffix')}</span></label>
          </div>
          {#if editing.recurrence.freq === 'weekly'}
            <div class="hstack" style="gap:4px; flex-wrap:wrap">
              {#each dayLabels as d, i}
                <button class={(editing.recurrence.daysOfWeek || []).includes(i) ? 'active' : ''} onclick={() => toggleRecurrenceDay(i)}>{d}</button>
              {/each}
            </div>
          {:else if editing.recurrence.freq === 'monthly'}
            <label class="field"><span>{tr('planner.dayOfMonth')}</span><input type="number" min="1" max="31" bind:value={editing.recurrence.dayOfMonth} /></label>
          {/if}
          <label class="field"><span>{tr('planner.ends')}</span><input type="date" bind:value={editing.recurrence.endDate} /></label>
          <div class="muted" style="font-size:12px">{ruleText(editing.recurrence)}</div>
          <button class="danger" onclick={() => (editing.recurrence = null)}>{tr('planner.removeRecurrence')}</button>
        </div>
        <div class="hint">{tr('planner.recurrenceHint')}</div>
      {/if}

      <div class="section-title">{tr('planner.linkedResources')}</div>
      <div class="hstack" style="gap:6px; flex-wrap:wrap">
        <select bind:this={linkSelect}>
          {#each docs as d}<option value={d.id}>{d.title}</option>{/each}
          <option value="deck">{tr('planner.deckLink')}</option>
        </select>
        <input type="number" min="1" value="1" bind:this={linkPage} style="width:70px" title={tr('common.pageShort')} />
        <button onclick={() => addLink(linkSelect, linkPage)}>{tr('planner.addLink')}</button>
      </div>
      {#each editing.links as link, i}
        <div class="hstack" style="gap:6px; margin-top:4px">
          <span class="badge">
            <Icon name={link.kind === 'pdf' ? 'reader' : 'flashcards'} size={12} />
            {link.kind === 'pdf' ? `${link.title}${link.page ? ` ${tr('common.pageShort')}.${link.page}` : ''}` : tr('planner.deckLink')}
          </span>
          <button onclick={() => removeLink(i)} aria-label={tr('common.remove')} title={tr('common.remove')}><Icon name="x" size={13} /></button>
        </div>
      {/each}

      <div class="section-title">{tr('planner.checklist')}</div>
      <div class="hstack" style="gap:6px">
        <input type="text" placeholder={tr('planner.addStep')} bind:this={checkInput} onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addChecklistItem(checkInput); } }} />
        <button onclick={() => addChecklistItem(checkInput)}>{tr('common.add')}</button>
      </div>
      {#each editing.checklist as c (c.id)}
        <div class="hstack" style="gap:6px; margin-top:4px">
          <input type="checkbox" bind:checked={c.done} /> <span class="grow">{c.text}</span>
          <button onclick={() => removeChecklistItem(c.id)} aria-label={tr('common.remove')} title={tr('common.remove')}><Icon name="x" size={13} /></button>
        </div>
      {/each}

      <div class="modal-actions">
        {#if editing.createdAt}<button class="danger" onclick={() => removeTask(editing)}>{tr('common.delete')}</button>{/if}
        <span style="flex:1"></span>
        <button onclick={() => (editing = null)}>{tr('common.cancel')}</button>
        <button class="primary" onclick={() => saveTask(editing)}>{tr('common.save')}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .planner { display: flex; flex-direction: column; gap: 12px; }
  .planner-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .overdue-banner { display: flex; align-items: center; gap: 8px; background: rgba(229, 72, 77, 0.1); border: 1px solid var(--danger); color: var(--danger); border-radius: 8px; padding: 8px 12px; font-size: 13px; }

  .month-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 8px; }
  .dow { text-align: center; font-size: 11px; color: var(--muted); padding: 4px 0; }
  .month-cell { min-height: 84px; border: 1px solid var(--border); border-radius: 6px; padding: 4px; background: var(--surface); cursor: pointer; overflow: hidden; }
  .month-cell:hover { border-color: var(--accent); }
  .month-cell.today { border-color: var(--accent); background: var(--accent-soft); }
  .month-cell.faded { opacity: 0.45; }
  .cell-date { font-size: 12px; font-weight: 600; margin-bottom: 2px; }
  .chip { font-size: 11px; padding: 1px 5px; border-radius: 4px; background: var(--surface-2); margin-bottom: 2px; cursor: grab; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 4px; }
  .chip.done { text-decoration: line-through; opacity: 0.55; }
  .chip .dot { width: 6px; height: 6px; border-radius: 50%; flex: none; }
  .more { font-size: 10px; color: var(--muted); }

  .week-scroll { overflow: auto; max-height: calc(100vh - 320px); border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
  .week-grid { display: grid; grid-template-columns: 44px repeat(7, 1fr); min-width: 700px; }
  .week-dayhead { position: sticky; top: 0; z-index: 2; background: var(--surface); border-bottom: 1px solid var(--border); text-align: center; font-size: 12px; font-weight: 600; padding: 6px 0; cursor: pointer; }
  .week-dayhead.today { color: var(--accent); }
  .week-corner { position: sticky; top: 0; z-index: 3; background: var(--surface); border-bottom: 1px solid var(--border); }
  .hour-gutter { border-inline-end: 1px solid var(--border); }
  .hour-label { height: 48px; font-size: 10px; color: var(--muted); text-align: end; padding-inline-end: 4px; }
  .week-col { position: relative; border-inline-end: 1px solid var(--border); height: 1152px; }
  .hour-line { height: 48px; border-bottom: 1px solid var(--border); }
  .time-block { position: absolute; inset-inline: 2px; background: var(--accent-soft); border-inline-start: 3px solid var(--accent); border-radius: 4px; padding: 2px 5px; font-size: 11px; overflow: hidden; cursor: grab; }
  .time-block.done { opacity: 0.5; text-decoration: line-through; }
  .tb-title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tb-time { color: var(--muted); font-size: 10px; }

  .agenda-row { display: flex; align-items: flex-start; gap: 10px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; margin-bottom: 8px; }
  .agenda-row.done .title { text-decoration: line-through; opacity: 0.55; }
  .agenda-row.overdue { border-color: var(--danger); }
  .row-meta { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; padding-inline-start: 11px; }
  .row-meta .badge { display: inline-flex; align-items: center; gap: 4px; }
  .link-chip { cursor: pointer; }
  .mini-check { display: flex; flex-direction: column; gap: 2px; padding: 6px 0 0; padding-inline-start: 11px; }

  .modal-backdrop { position: fixed; inset: 0; background: rgba(10, 10, 20, 0.45); z-index: 60; display: grid; place-items: center; padding: 20px; }
  .modal { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow); padding: 20px; width: min(620px, 100%); max-height: 88vh; overflow: auto; }
  .field { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--muted); flex: 1; }
  .field input, .field select, .field textarea { color: var(--text); }
  .field-row { display: flex; gap: 10px; margin: 8px 0; flex-wrap: wrap; }
  .rec-card { border: 1px solid var(--border); border-radius: 8px; padding: 10px; margin: 6px 0; display: flex; flex-direction: column; gap: 8px; }
  .hint { font-size: 12px; color: var(--muted); margin-top: 4px; }
  .modal-actions { display: flex; gap: 8px; margin-top: 16px; }
  button.danger { color: var(--danger); border-color: var(--danger); }
</style>
