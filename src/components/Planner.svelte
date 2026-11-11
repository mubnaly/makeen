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
  import {
    listCustomReminders, addCustomReminder, deleteCustomReminder, updateCustomReminder,
    toggleCustomReminder, getRemainingTimeText, ADVANCE_NOTICE_OPTIONS, REPEAT_OPTIONS
  } from '../lib/customReminders.js';
  import { AVAILABLE_SOUNDS, playNotificationTone } from '../lib/sound.js';
  import {
    getCachedGoogleCalendarEvents, syncGoogleCalendarFeed, getGoogleCalendarFeedUrl,
    saveGoogleCalendarFeedUrl, openInGoogleCalendar, downloadTasksIcs
  } from '../lib/googleCalendar.js';
  // `t` is a task variable in this file's markup, so the translator is `tr`.
  import { t as tr, ui } from '../lib/lang.svelte.js';
  import { describeRuleText, formatDate, formatMonth, weekdayShort } from '../lib/i18n.js';

  let { notify, docs = [], onOpenResource, onOpenAiBot } = $props();

  const PRIORITIES = ['low', 'normal', 'high'];
  const PRIORITY_LABEL = { low: 'planner.priorityLow', normal: 'planner.priorityNormal', high: 'planner.priorityHigh' };
  const VIEWS = [
    { id: 'month', label: 'planner.viewMonth' },
    { id: 'week', label: 'planner.viewWeek' },
    { id: 'day', label: 'planner.viewDay' },
    { id: 'list', label: 'planner.viewList' },
    { id: 'reminders', label: 'planner.customReminders' }
  ];
  const HOURS = Array.from({ length: 24 }, (_, i) => i);

  let tasks = $state([]);
  let customReminders = $state([]);
  let gcalEvents = $state([]);
  let view = $state('week'); // plan §6.8: week grid is the desktop default (day agenda on mobile)
  let anchor = $state(todayIso()); // focused date for month/week/day views
  let editing = $state(null); // task draft or null
  let remindersOn = $state(false);
  let reminderTimer = null;
  let linkSelect = $state();
  let linkPage = $state();
  let checkInput = $state();

  // Custom Reminders & Google Calendar State
  let reminderModalOpen = $state(false);
  let reminderDraft = $state(null);
  let gcalModalOpen = $state(false);
  let gcalFeedUrl = $state(getGoogleCalendarFeedUrl());
  let isSyncingGcal = $state(false);

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

  async function refresh() {
    tasks = await listTasks();
    customReminders = listCustomReminders();
    gcalEvents = getCachedGoogleCalendarEvents();
  }

  onMount(async () => {
    await refresh();
    remindersOn = localStorage.getItem('studyos.reminders') === '1';
    if (window.matchMedia('(max-width: 720px)').matches) view = 'day';
    startReminderLoop();

    const onRemindersUpdated = () => { customReminders = listCustomReminders(); };
    const onGcalUpdated = () => { gcalEvents = getCachedGoogleCalendarEvents(); };

    window.addEventListener('makeen:reminders-updated', onRemindersUpdated);
    window.addEventListener('makeen:gcal-updated', onGcalUpdated);

    // Auto sync Google Calendar if feed URL exists
    if (gcalFeedUrl) {
      syncGoogleCalendarFeed().then((res) => {
        if (res.ok) gcalEvents = getCachedGoogleCalendarEvents();
      });
    }

    return () => {
      stopReminderLoop();
      window.removeEventListener('makeen:reminders-updated', onRemindersUpdated);
      window.removeEventListener('makeen:gcal-updated', onGcalUpdated);
    };
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
    const local = tasks
      .filter((task) => taskOccursOn(task, iso))
      .sort((a, b) => (a.startTime || 'zz').localeCompare(b.startTime || 'zz'));
    const gcal = gcalEvents
      .filter((ev) => ev.dueDate === iso)
      .sort((a, b) => (a.startTime || 'zz').localeCompare(b.startTime || 'zz'));
    return [...local, ...gcal];
  }
  function doneTodayCount(iso) {
    return tasksForDay(iso).filter((task) => isDoneOn(task, iso)).length;
  }
  const ruleText = (rule) => describeRuleText(ui.lang, rule, tr);

  // --- custom reminders actions ---
  function openNewReminder() {
    const now = new Date();
    reminderDraft = {
      id: crypto.randomUUID(),
      title: '',
      notes: '',
      date: anchor || todayIso(),
      time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
      advanceMinutes: 0,
      repeat: 'none',
      sound: 'soft-chime',
      linkedResource: null
    };
    reminderModalOpen = true;
  }

  function saveReminderDraft() {
    if (!reminderDraft.title.trim()) {
      notify('يرجى إدخال عنوان التذكير', 'error');
      return;
    }
    addCustomReminder(reminderDraft);
    customReminders = listCustomReminders();
    reminderModalOpen = false;
    reminderDraft = null;
    notify('تم حفظ التذكير المخصص بنجاح', 'ok');
  }

  function handleToggleReminder(id) {
    toggleCustomReminder(id);
    customReminders = listCustomReminders();
  }

  function handleDeleteReminder(id) {
    if (!confirm('هل تريد حذف هذا التذكير المخصص؟')) return;
    deleteCustomReminder(id);
    customReminders = listCustomReminders();
    notify('تم حذف التذكير', 'ok');
  }

  function testSound(soundId) {
    playNotificationTone(soundId);
  }

  // --- google calendar actions ---
  async function handleSyncGcal() {
    if (!gcalFeedUrl.trim()) {
      notify('يرجى إدخال رابط iCal الخاص بتقويم Google', 'error');
      return;
    }
    isSyncingGcal = true;
    saveGoogleCalendarFeedUrl(gcalFeedUrl.trim());
    try {
      const res = await syncGoogleCalendarFeed(gcalFeedUrl.trim());
      if (res.ok) {
        gcalEvents = getCachedGoogleCalendarEvents();
        notify(`تمت مزامنة ${res.count} حدث بنجاح من تقويم Google`, 'ok');
        gcalModalOpen = false;
      } else {
        notify('تعذر مزامنة التقويم. يرجى التأكد من رابط iCal العام أو السري', 'error');
      }
    } catch (e) {
      notify(`فشلت المزامنة: ${e.message}`, 'error');
    } finally {
      isSyncingGcal = false;
    }
  }

  function handleExportIcs() {
    downloadTasksIcs(tasks);
    notify('تم تنزيل ملف التقويم (.ics) بنجاح', 'ok');
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
    <div class="hstack" style="gap:6px; flex-wrap:wrap;">
      {#each VIEWS as def}
        <button class={view === def.id ? 'active' : ''} onclick={() => (view = def.id)}>
          {#if def.id === 'reminders'}
            <Icon name="bell" size={13} />
          {/if}
          <span>{tr(def.label)}</span>
        </button>
      {/each}

      <div class="header-divider" style="width: 1px; height: 18px; background: var(--border); margin: 0 4px;"></div>

      <!-- Google Calendar Sync Button -->
      <button
        type="button"
        class="small hstack"
        onclick={() => (gcalModalOpen = true)}
        title="مزامنة وتكامل تقويم Google"
        style="border-color: #4285f4; color: #4285f4;"
      >
        <Icon name="calendar" size={14} />
        <span>تقويم Google</span>
        {#if gcalEvents.length > 0}
          <span class="pill-count" style="background: rgba(66, 133, 244, 0.15); color: #4285f4; padding: 1px 6px; border-radius: 999px; font-size: 11px;">
            {gcalEvents.length}
          </span>
        {/if}
      </button>

      <!-- Makeen AI Assistant Button -->
      {#if onOpenAiBot}
        <button
          type="button"
          class="small hstack"
          onclick={onOpenAiBot}
          title="مساعد مَكِين الذكي لجدولة المهام والقراءة"
          style="border-color: #8b5cf6; color: #8b5cf6;"
        >
          <Icon name="sparkles" size={14} />
          <span>المساعد الذكي</span>
        </button>
      {/if}

      <label class="hstack" style="gap:4px; font-size:13px" title={tr('planner.remindersTitle')}>
        <input type="checkbox" checked={remindersOn} onchange={toggleReminders} /> {tr('planner.reminders')}
      </label>

      {#if view === 'reminders'}
        <button class="primary small hstack" onclick={openNewReminder}>
          <Icon name="plus" size={14} /><span>تذكير مخصص +</span>
        </button>
      {:else}
        <button class="primary small hstack" onclick={() => (editing = newDraft())}>
          <Icon name="plus" size={14} /><span>{tr('planner.newTask')}</span>
        </button>
      {/if}
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
            {#each HOURS as h}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <div
                class="hour-line clickable-hour"
                role="button"
                tabindex="0"
                title={`${dayLabels[weekDays.indexOf(iso)]} الساعة ${String(h).padStart(2, '0')}:00 — انقر لإضافة موعد أو مهمة`}
                onclick={() => {
                  editing = newDraft(iso);
                  editing.startTime = `${String(h).padStart(2, '0')}:00`;
                  editing.durationMinutes = 60;
                }}
              ></div>
            {/each}
            {#each tasksForDay(iso).filter((task) => task.startTime) as task}
              <div class="time-block {isDoneOn(task, iso) ? 'done' : ''} {task.isGCal ? 'gcal-block' : ''}" style="top:{blockTop(task)}px; height:{blockHeight(task)}px; border-inline-start-color:{task.isGCal ? '#4285f4' : priorityDot(task.priority)}"
                draggable={!task.isGCal} ondragstart={(e) => onDragStart(e, task)}
                onclick={() => { if (task.isGCal) openInGoogleCalendar(task); else editTask(task); }}
                title={`${task.title} · ${task.startTime}${task.isGCal ? ' (Google Calendar)' : ''}`}>
                <div class="tb-title hstack" style="gap:4px;">
                  {#if task.isGCal}<Icon name="calendar" size={11} />{/if}
                  <span>{task.title}</span>
                </div>
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

    {:else if view === 'reminders'}
      <!-- Custom Reminders View -->
      <div class="reminders-view-container">
        <div class="reminders-header-card hstack" style="justify-content:space-between; margin-bottom:12px; padding:12px 16px; background:var(--surface); border:1px solid var(--border); border-radius:10px; flex-wrap:wrap; gap:8px;">
          <div>
            <div style="font-weight:700; font-size:14px;" class="hstack">
              <Icon name="bell" size={16} />
              <span>التذكيرات المخصصة (Custom Reminders)</span>
            </div>
            <div class="muted" style="font-size:12px; margin-top:2px;">
              تنبيهات صوتية وإشعارات مرئية على الهاتف وسطح المكتب والمتصفح في الوقت المحدد بدقة
            </div>
          </div>
          <button class="primary small hstack" onclick={openNewReminder}>
            <Icon name="plus" size={14} />
            <span>إضافة تذكير مخصص</span>
          </button>
        </div>

        {#if customReminders.length === 0}
          <div class="empty" style="padding:40px 20px; text-align:center;">
            <Icon name="bell" size={32} />
            <div style="margin-top:8px; font-weight:600;">لا توجد تذكيرات مخصصة حالياً</div>
            <div class="muted" style="font-size:12.5px; margin-top:4px;">
              أضف تذكيراً لأوقات المذاكرة، المحاضرات، قراءة الكتب، أو مراجعة البطاقات مع نغمات صوتية واضحة
            </div>
            <button class="primary small hstack" onclick={openNewReminder} style="margin:16px auto 0;">
              <Icon name="plus" size={14} />
              <span>إنشاء أول تذكير الآن</span>
            </button>
          </div>
        {:else}
          <div class="reminders-list">
            {#each customReminders as rem (rem.id)}
              <div class="reminder-card {rem.enabled ? '' : 'disabled-reminder'}">
                <div class="hstack" style="align-items:flex-start; gap:12px; width:100%;">
                  <input
                    type="checkbox"
                    checked={rem.enabled}
                    onchange={() => handleToggleReminder(rem.id)}
                    title={rem.enabled ? 'تعطيل التنبيه' : 'تفعيل التنبيه'}
                    style="margin-top:4px; width:18px; height:18px;"
                  />

                  <div class="grow">
                    <div class="hstack" style="justify-content:space-between; gap:8px; flex-wrap:wrap;">
                      <div class="reminder-title" style="font-weight:700; font-size:14px; {rem.enabled ? '' : 'text-decoration:line-through; opacity:0.6;'}">
                        {rem.title}
                      </div>

                      <div class="hstack" style="gap:6px;">
                        <span class="badge {rem.remainingMinutes <= 0 && rem.enabled ? 'due-badge' : ''}" style="font-size:11px;">
                          <Icon name="clock" size={11} />
                          <span>{getRemainingTimeText(rem)}</span>
                        </span>

                        <span class="badge" style="font-size:11px;">
                          <Icon name="repeat" size={11} />
                          <span>{REPEAT_OPTIONS.find((r) => r.id === rem.repeat)?.label || 'مرة واحدة'}</span>
                        </span>
                      </div>
                    </div>

                    {#if rem.notes}
                      <div class="muted" style="font-size:12px; margin-top:4px;">{rem.notes}</div>
                    {/if}

                    <div class="row-meta" style="margin-top:8px;">
                      <span class="badge" style="font-size:11px;">
                        <Icon name="calendar" size={11} />
                        <span>{rem.date}</span>
                      </span>

                      <span class="badge" style="font-size:11px;">
                        <Icon name="clock" size={11} />
                        <span>{rem.time}</span>
                      </span>

                      {#if rem.advanceMinutes > 0}
                        <span class="badge" style="font-size:11px;">
                          <span>تنبيه مسبق: {rem.advanceMinutes} دقيقة</span>
                        </span>
                      {/if}

                      <button
                        type="button"
                        class="badge link-chip hstack"
                        onclick={() => testSound(rem.sound)}
                        title="تجربة نغمة التنبيه"
                        style="font-size:11px; cursor:pointer;"
                      >
                        <Icon name="play" size={10} />
                        <span>{AVAILABLE_SOUNDS.find((s) => s.id === rem.sound)?.name || 'نغمة'}</span>
                      </button>

                      {#if rem.linkedResource}
                        <button
                          class="badge link-chip hstack"
                          onclick={() => onOpenResource?.(rem.linkedResource)}
                          title="فتح العنصر المرتبط"
                          style="font-size:11px;"
                        >
                          <Icon name="reader" size={11} />
                          <span>{rem.linkedResource.title || 'الملف المرتبط'}</span>
                        </button>
                      {/if}
                    </div>
                  </div>

                  <div class="hstack" style="gap:4px;">
                    <button
                      type="button"
                      class="icon-btn danger small"
                      onclick={() => handleDeleteReminder(rem.id)}
                      title="حذف التذكير"
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
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
        <button
          type="button"
          class="secondary hstack"
          onclick={() => openInGoogleCalendar(editing)}
          title="إضافة هذه المهمة مباشرة إلى تقويم Google"
          style="gap: 5px; color: #4285f4; border-color: #4285f4;"
        >
          <Icon name="calendar" size={13} />
          <span>إضافة إلى Google Calendar</span>
        </button>
        <span style="flex:1"></span>
        <button onclick={() => (editing = null)}>{tr('common.cancel')}</button>
        <button class="primary" onclick={() => saveTask(editing)}>{tr('common.save')}</button>
      </div>
    </div>
  </div>
{/if}

<!-- Custom Reminder Creation / Edit Modal Dialog -->
{#if reminderModalOpen && reminderDraft}
  <div class="modal-backdrop" onclick={() => (reminderModalOpen = false)} onkeydown={(e) => e.key === 'Escape' && (reminderModalOpen = false)} role="presentation">
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="تعديل أو إنشاء تذكير مخصص">
      <div class="hstack" style="justify-content:space-between; margin-bottom:12px;">
        <h3 style="margin:0;" class="hstack">
          <Icon name="bell" size={18} />
          <span>إضافة تذكير مخصص (Custom Reminder)</span>
        </h3>
        <button class="icon-btn" onclick={() => (reminderModalOpen = false)} aria-label="إغلاق">
          <Icon name="x" size={16} />
        </button>
      </div>

      <label class="field">
        <span>عنوان التذكير</span>
        <input type="text" bind:value={reminderDraft.title} placeholder="مثال: جلسة قراءة كتاب البرمجة، مراجعة الرياضيات، صلاة العصر" />
      </label>

      <label class="field" style="margin-top:8px;">
        <span>ملاحظات إضافية</span>
        <textarea rows="2" bind:value={reminderDraft.notes} placeholder="تفاصيل إضافية عن ما يجب فعله..."></textarea>
      </label>

      <div class="field-row">
        <label class="field">
          <span>التاريخ</span>
          <input type="date" bind:value={reminderDraft.date} />
        </label>
        <label class="field">
          <span>الوقت بدقة</span>
          <input type="time" bind:value={reminderDraft.time} />
        </label>
      </div>

      <div class="field-row">
        <label class="field">
          <span>وقت التنبيه المسبق</span>
          <select bind:value={reminderDraft.advanceMinutes}>
            {#each ADVANCE_NOTICE_OPTIONS as opt}
              <option value={opt.value}>{opt.label}</option>
            {/each}
          </select>
        </label>

        <label class="field">
          <span>تكرار التنبيه</span>
          <select bind:value={reminderDraft.repeat}>
            {#each REPEAT_OPTIONS as rep}
              <option value={rep.id}>{rep.label}</option>
            {/each}
          </select>
        </label>
      </div>

      <div class="field-row" style="align-items:flex-end;">
        <label class="field" style="flex:1;">
          <span>نغمة التنبيه الصوتية</span>
          <select bind:value={reminderDraft.sound}>
            {#each AVAILABLE_SOUNDS as snd}
              <option value={snd.id}>{snd.name}</option>
            {/each}
          </select>
        </label>
        <button
          type="button"
          class="secondary hstack"
          onclick={() => testSound(reminderDraft.sound)}
          title="تجربة النغمة المختارة"
          style="height:36px; padding:0 12px;"
        >
          <Icon name="play" size={13} />
          <span>تجربة الصوت</span>
        </button>
      </div>

      <label class="field" style="margin-top:8px;">
        <span>ربط بملف من المكتبة (اختياري)</span>
        <select
          value={reminderDraft.linkedResource?.id || ''}
          onchange={(e) => {
            const val = e.currentTarget.value;
            if (!val) {
              reminderDraft.linkedResource = null;
            } else {
              const d = docs.find((item) => item.id === val);
              if (d) reminderDraft.linkedResource = { id: d.id, title: d.title, kind: 'pdf' };
            }
          }}
        >
          <option value="">بدون ملف مرتبط</option>
          {#each docs as doc}
            <option value={doc.id}>{doc.title}</option>
          {/each}
        </select>
      </label>

      <div class="modal-actions" style="margin-top:16px;">
        <button type="button" onclick={() => (reminderModalOpen = false)}>إلغاء</button>
        <span style="flex:1"></span>
        <button type="button" class="primary hstack" onclick={saveReminderDraft}>
          <Icon name="check" size={14} />
          <span>حفظ التذكير</span>
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Google Calendar Sync & Export Modal Dialog -->
{#if gcalModalOpen}
  <div class="modal-backdrop" onclick={() => (gcalModalOpen = false)} onkeydown={(e) => e.key === 'Escape' && (gcalModalOpen = false)} role="presentation">
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="مزامنة وتكامل تقويم Google">
      <div class="hstack" style="justify-content:space-between; margin-bottom:12px;">
        <h3 style="margin:0; color:#4285f4;" class="hstack">
          <Icon name="calendar" size={18} />
          <span>تكامل تقويم Google (Google Calendar Sync)</span>
        </h3>
        <button class="icon-btn" onclick={() => (gcalModalOpen = false)} aria-label="إغلاق">
          <Icon name="x" size={16} />
        </button>
      </div>

      <p class="muted" style="font-size:12.5px; line-height:1.6; margin-top:0;">
        يمكنك استعراض ومزامنة مواعيدك وأحداثك من Google Calendar مباشرة على شبكة ومخطط مَكِين، بالإضافة لتصدير مهامك كملف تقويم عالمي.
      </p>

      <div class="card" style="padding:12px; margin-bottom:14px; background:var(--surface-2); border-radius:8px;">
        <div style="font-weight:700; font-size:13px; margin-bottom:6px;">خطوات الحصول على رابط تقويمك (iCal Feed):</div>
        <ol style="margin:0; padding-inline-start:18px; font-size:12px; color:var(--muted); line-height:1.6;">
          <li>افتح Google Calendar على المتصفح وانتقل إلى <b>الإعدادات (Settings)</b>.</li>
          <li>من القائمة الجانبية، اختر التقويم الخاص بك، ثم انزل إلى <b>تكامل التقويم (Integrate calendar)</b>.</li>
          <li>انسخ <b>عنوان سري بتنسيق iCal (Secret address in iCal format)</b> والصقه بالأسفل.</li>
        </ol>
      </div>

      <label class="field">
        <span>رابط iCal الخاص بتقويم Google (.ics)</span>
        <input
          type="url"
          bind:value={gcalFeedUrl}
          placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
          style="direction:ltr; text-align:left;"
        />
      </label>

      <div class="hstack" style="gap:8px; margin-top:12px; flex-wrap:wrap;">
        <button
          type="button"
          class="primary hstack"
          onclick={handleSyncGcal}
          disabled={isSyncingGcal || !gcalFeedUrl.trim()}
          style="background:#4285f4; border-color:#4285f4;"
        >
          {#if isSyncingGcal}
            <Icon name="rotate-right" size={14} class="spin" />
            <span>جارِ المزامنة...</span>
          {:else}
            <Icon name="rotate-right" size={14} />
            <span>مزامنة الأحداث الآن</span>
          {/if}
        </button>

        <button
          type="button"
          class="secondary hstack"
          onclick={handleExportIcs}
          title="تصدير مهام مَكِين لاستيرادها في أي تطبيق تقويم"
        >
          <Icon name="download" size={14} />
          <span>تصدير المهام (.ics)</span>
        </button>
      </div>

      {#if gcalEvents.length > 0}
        <div class="hstack" style="margin-top:14px; padding:8px 12px; background:rgba(66, 133, 244, 0.08); border:1px solid rgba(66, 133, 244, 0.25); border-radius:6px; justify-content:space-between;">
          <span style="font-size:12.5px; color:#4285f4; font-weight:600;">
            تمت مزامنة {gcalEvents.length} حدث من تقويم Google بنجاح
          </span>
          <button
            type="button"
            class="icon-btn small"
            onclick={() => { gcalEvents = []; saveGoogleCalendarFeedUrl(''); gcalFeedUrl = ''; notify('تم إلغاء مزامنة التقويم', 'ok'); }}
            title="إلغاء المزامنة ومسح الأحداث"
          >
            <Icon name="trash" size={13} />
          </button>
        </div>
      {/if}

      <div class="modal-actions" style="margin-top:18px;">
        <span style="flex:1"></span>
        <button type="button" onclick={() => (gcalModalOpen = false)}>إغلاق</button>
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
  .clickable-hour { cursor: pointer; transition: background 0.15s ease; }
  .clickable-hour:hover { background: rgba(59, 130, 246, 0.1); }
  .gcal-block { background: rgba(66, 133, 244, 0.15) !important; color: #1a73e8 !important; }
  .reminder-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px 14px;
    margin-bottom: 8px;
    transition: all 0.2s ease;
  }
  .reminder-card:hover {
    border-color: var(--accent);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  }
  .disabled-reminder {
    opacity: 0.6;
    background: var(--surface-2);
  }
  .due-badge {
    background: var(--danger) !important;
    color: #fff !important;
    animation: pulse 1.5s infinite;
  }
  @keyframes pulse {
    0% { opacity: 1; }
    50% { opacity: 0.6; }
    100% { opacity: 1; }
  }
  .modal-actions { display: flex; gap: 8px; margin-top: 16px; }
  button.danger { color: var(--danger); border-color: var(--danger); }
</style>
