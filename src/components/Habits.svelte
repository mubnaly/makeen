<script>
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { t, ui } from '../lib/lang.svelte.js';
  import {
    listHabits,
    createHabit,
    deleteHabit,
    recordHabitCheck,
    getHabitStreak,
    todayDateKey,
    listGoals,
    addGoal,
    toggleGoal,
    deleteGoal
  } from '../lib/habits.js';

  let { notify = null } = $props();

  let habits = $state([]);
  let todayKey = $state(todayDateKey());
  let goals = $state([]);
  let newGoalText = $state('');

  // Quick Add Habit
  let quickHabitTitle = $state('');

  const HABIT_PRESETS = [
    { title: 'أذكار الصباح والمساء', icon: 'moon', color: '#7950f2', target: 2 },
    { title: 'قراءة ورد القرآن', icon: 'book', color: '#2f9e6f', target: 1 },
    { title: 'قراءة 20 صفحة', icon: 'file-text', color: '#4f6bff', target: 1 },
    { title: 'ممارسة الرياضة', icon: 'activity', color: '#e5484d', target: 1 },
    { title: 'شرب 2 لتر ماء', icon: 'check', color: '#1098ad', target: 1 },
    { title: 'مراجعة البطاقات التعليمية', icon: 'star', color: '#f59f00', target: 1 }
  ];

  function handleQuickAddHabit() {
    if (!quickHabitTitle.trim()) return;
    createHabit({
      title: quickHabitTitle.trim(),
      targetCount: 1,
      color: COLOR_OPTIONS[Math.floor(Math.random() * COLOR_OPTIONS.length)],
      icon: 'check'
    });
    quickHabitTitle = '';
    reload();
    notify?.(t('habits.createSuccess') || 'تمت إضافة العادة بنجاح', 'ok');
  }

  function handleApplyPreset(p) {
    createHabit({
      title: p.title,
      targetCount: p.target || 1,
      color: p.color,
      icon: p.icon
    });
    reload();
    notify?.(t('habits.createSuccess') || 'تمت إضافة العادة بنجاح', 'ok');
  }

  // Modal for new habit
  let isAddModalOpen = $state(false);
  let newHabitTitle = $state('');
  let newHabitTarget = $state(1);
  let newHabitColor = $state('#4f6bff');
  let newHabitIcon = $state('check');

  const COLOR_OPTIONS = ['#4f6bff', '#2f9e6f', '#e5484d', '#f59f00', '#7950f2', '#1098ad', '#d6336c'];
  const ICON_OPTIONS = ['check', 'book', 'moon', 'activity', 'star', 'video', 'file-text'];

  // Past 7 days array (from 6 days ago up to today)
  function getRecentDays() {
    const days = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = todayDateKey(d);
      const dayName = d.toLocaleDateString(ui.lang === 'ar' ? 'ar-EG' : 'en-US', { weekday: 'short' });
      const dayNum = d.getDate();
      days.push({ key, dayName, dayNum, isToday: i === 0 });
    }
    return days;
  }

  let recentDays = $derived(getRecentDays());

  function reload() {
    habits = listHabits();
    todayKey = todayDateKey();
    goals = listGoals(todayKey);
  }

  onMount(() => {
    reload();
  });

  // Derived stats
  const completedTodayCount = $derived(
    habits.filter((h) => (Number(h.history?.[todayKey]) || 0) >= (Number(h.targetCount) || 1)).length
  );
  const totalStreaks = $derived(
    habits.reduce((acc, h) => acc + getHabitStreak(h, todayKey), 0)
  );
  const completedGoalsCount = $derived(goals.filter((g) => g.done).length);

  function handleCheck(habitId, dateKey, delta = 1) {
    recordHabitCheck(habitId, dateKey, delta);
    reload();
  }

  function handleAddGoal() {
    if (!newGoalText.trim()) return;
    addGoal(newGoalText.trim(), todayKey);
    newGoalText = '';
    reload();
    notify?.(t('common.done') || 'Goal added', 'ok');
  }

  function handleToggleGoal(id) {
    toggleGoal(id);
    reload();
  }

  function handleDeleteGoal(id) {
    deleteGoal(id);
    reload();
  }

  function handleCreateHabit() {
    if (!newHabitTitle.trim()) return;
    createHabit({
      title: newHabitTitle.trim(),
      targetCount: newHabitTarget,
      color: newHabitColor,
      icon: newHabitIcon
    });
    newHabitTitle = '';
    newHabitTarget = 1;
    isAddModalOpen = false;
    reload();
    notify?.(t('habits.createSuccess') || 'Habit created', 'ok');
  }

  function handleDeleteHabit(id, title) {
    if (confirm(t('habits.deleteConfirm') || `Delete habit "${title}"?`)) {
      deleteHabit(id);
      reload();
    }
  }
</script>

<div class="habits-container">
  <!-- Top Header with Stats -->
  <div class="habits-header">
    <div>
      <h2 class="habits-title">{t('habits.title')}</h2>
      <p class="muted" style="margin:2px 0 0 0; font-size:13px;">{t('habits.subtitle')}</p>
    </div>
    <button class="primary hstack" style="gap:6px;" onclick={() => (isAddModalOpen = true)}>
      <Icon name="plus" size={15} />
      <span>{t('habits.newHabit')}</span>
    </button>
  </div>

  <!-- Metric Badges -->
  <div class="stats-row">
    <div class="stat-card">
      <div class="stat-num">{completedTodayCount} / {habits.length}</div>
      <div class="stat-label">{t('habits.completedToday')}</div>
    </div>
    <div class="stat-card">
      <div class="stat-num hstack" style="gap:4px;"><Icon name="flame" size={18} /><span>{totalStreaks}</span></div>
      <div class="stat-label">{t('habits.streak')} ({t('habits.days')})</div>
    </div>
    <div class="stat-card">
      <div class="stat-num">{completedGoalsCount} / {goals.length}</div>
      <div class="stat-label">{t('habits.todayGoals')}</div>
    </div>
  </div>

  <!-- Section: Today's Goals (أهداف اليوم) -->
  <div class="goals-card card">
    <div class="section-title" style="margin-top:0;">{t('habits.todayGoals')}</div>
    <div class="goals-input-row">
      <input
        type="text"
        placeholder={t('habits.addGoal')}
        bind:value={newGoalText}
        onkeydown={(e) => e.key === 'Enter' && handleAddGoal()}
      />
      <button class="primary small" onclick={handleAddGoal} disabled={!newGoalText.trim()}>
        <Icon name="plus" size={13} />
        <span>{t('common.add')}</span>
      </button>
    </div>

    {#if goals.length === 0}
      <p class="muted" style="font-size:12.5px; margin:10px 0 0 0;">
        {ui.lang === 'ar' ? 'لم تضف أهدافًا بعد لليوم. اكتب هدفك واضغط Enter!' : 'No goals for today yet. Type and press Enter!'}
      </p>
    {:else}
      <div class="goals-list">
        {#each goals as g (g.id)}
          <div class="goal-item" class:done={g.done}>
            <button class="checkbox-circle" onclick={() => handleToggleGoal(g.id)}>
              {#if g.done}<Icon name="check" size={12} />{/if}
            </button>
            <span class="goal-text">{g.text}</span>
            <button class="delete-btn" onclick={() => handleDeleteGoal(g.id)} title={t('common.delete')}>
              <Icon name="x" size={13} />
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Section: Habits Grid / Tracker -->
  <div class="habits-list-section">
    <div class="section-title">{t('habits.allHabits')}</div>

    <!-- Quick Add Habit Card & Preset Suggestions -->
    <div class="quick-add-habit-card card">
      <div class="quick-add-input-row">
        <input
          type="text"
          placeholder={ui.lang === 'ar' ? 'أضف عادة جديدة واضغط Enter (مثل: قراءة ورد القرآن)...' : 'Add new habit and press Enter...'}
          bind:value={quickHabitTitle}
          onkeydown={(e) => e.key === 'Enter' && handleQuickAddHabit()}
        />
        <button class="primary small" onclick={handleQuickAddHabit} disabled={!quickHabitTitle.trim()}>
          <Icon name="plus" size={14} />
          <span>{ui.lang === 'ar' ? 'إضافة' : 'Add'}</span>
        </button>
      </div>

      <div class="habit-presets-row">
        <span class="preset-label">{ui.lang === 'ar' ? 'اقتراحات سريعة:' : 'Quick presets:'}</span>
        {#each HABIT_PRESETS as preset}
          <button type="button" class="preset-pill" onclick={() => handleApplyPreset(preset)}>
            <span class="preset-plus" style={`color:${preset.color}`}>+</span>
            <span>{preset.title}</span>
          </button>
        {/each}
      </div>
    </div>

    {#if habits.length === 0}
      <div class="card empty-habits">
        <p class="muted">{t('habits.noHabits')}</p>
        <button class="primary small mt" onclick={() => (isAddModalOpen = true)}>
          <Icon name="plus" size={13} />
          <span>{t('habits.newHabit')}</span>
        </button>
      </div>
    {:else}
      <div class="habits-table-wrap">
        <div class="habits-table card">
          <!-- Table Header Days -->
          <div class="table-header-row">
            <div class="col-info">{t('habits.habitName')}</div>
            <div class="col-days">
              {#each recentDays as d}
                <div class="day-head {d.isToday ? 'today' : ''}">
                  <span class="day-name">{d.dayName}</span>
                  <span class="day-num">{d.dayNum}</span>
                </div>
              {/each}
            </div>
            <div class="col-actions"></div>
          </div>

          <!-- Habit Rows -->
          {#each habits as h (h.id)}
            {@const streak = getHabitStreak(h, todayKey)}
            <div class="habit-row">
              <div class="col-info">
                <span class="habit-icon" style={`background:${h.color}20; color:${h.color};`}>
                  <Icon name={h.icon || 'check'} size={15} />
                </span>
                <div class="habit-details">
                  <span class="habit-name">{h.title}</span>
                  <span class="habit-meta">
                    {h.targetCount > 1 ? `${h.targetCount}x / يوم` : ''}
                    {#if streak > 0}
                      <span class="streak-pill hstack" style="gap:2px;">
                        <Icon name="flame" size={11} />
                        <span>{streak} {t('habits.days')}</span>
                      </span>
                    {/if}
                  </span>
                </div>
              </div>

              <!-- Day Check Bubbles -->
              <div class="col-days">
                {#each recentDays as d}
                  {@const count = Number(h.history?.[d.key]) || 0}
                  {@const isDone = count >= (Number(h.targetCount) || 1)}
                  <button
                    class="day-bubble {isDone ? 'is-done' : count > 0 ? 'is-partial' : ''} {d.isToday ? 'is-today-col' : ''}"
                    style={isDone ? `background:${h.color}; border-color:${h.color}; color:#fff;` : ''}
                    onclick={() => handleCheck(h.id, d.key, 1)}
                    title={`${d.dayName} ${d.dayNum}: ${count}/${h.targetCount}`}
                  >
                    {#if isDone}
                      <Icon name="check" size={12} />
                    {:else if count > 0}
                      <span style="font-size:10px; font-weight:700;">{count}</span>
                    {/if}
                  </button>
                {/each}
              </div>

              <div class="col-actions">
                <button
                  class="icon-action-btn"
                  onclick={() => handleDeleteHabit(h.id, h.title)}
                  title={t('common.delete')}
                >
                  <Icon name="trash" size={13} />
                </button>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</div>

<!-- Modal: Add New Habit -->
{#if isAddModalOpen}
  <div class="modal-backdrop" onclick={() => (isAddModalOpen = false)} role="presentation">
    <div class="modal card" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3>{t('habits.newHabit')}</h3>
        <button class="close-btn" onclick={() => (isAddModalOpen = false)}>
          <Icon name="x" size={16} />
        </button>
      </div>

      <div class="modal-body">
        <label class="field">
          <span>{t('habits.habitName')}</span>
          <input type="text" bind:value={newHabitTitle} placeholder="مثال: قراءة القرآن، حفظ الكلمات..." />
        </label>

        <label class="field">
          <span>{t('habits.targetPerDay')}</span>
          <input type="number" min="1" max="10" bind:value={newHabitTarget} />
        </label>

        <div class="field">
          <span>اللون المميز</span>
          <div class="color-picker-row">
            {#each COLOR_OPTIONS as c}
              <button
                type="button"
                class="color-dot {newHabitColor === c ? 'selected' : ''}"
                style={`background:${c};`}
                onclick={() => (newHabitColor = c)}
              ></button>
            {/each}
          </div>
        </div>

        <div class="field">
          <span>الأيقونة</span>
          <div class="icon-picker-row">
            {#each ICON_OPTIONS as ic}
              <button
                type="button"
                class="icon-choice {newHabitIcon === ic ? 'selected' : ''}"
                onclick={() => (newHabitIcon = ic)}
              >
                <Icon name={ic} size={15} />
              </button>
            {/each}
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button onclick={() => (isAddModalOpen = false)}>{t('common.cancel')}</button>
        <button class="primary" onclick={handleCreateHabit} disabled={!newHabitTitle.trim()}>
          {t('common.create')}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .habits-container {
    max-width: 900px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .habits-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .habits-title {
    margin: 0;
    font-size: 22px;
    font-weight: 700;
  }

  .stats-row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }
  .stat-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    box-shadow: var(--shadow);
  }
  .stat-num {
    font-size: 20px;
    font-weight: 800;
    color: var(--accent);
  }
  .stat-label {
    font-size: 12px;
    color: var(--muted);
  }

  .goals-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .goals-input-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .goals-input-row input {
    flex: 1;
    min-width: 0;
  }

  .goals-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 6px;
  }
  .goal-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    background: var(--surface-2);
    border-radius: 8px;
    border: 1px solid transparent;
    transition: all 0.15s;
  }
  .goal-item:hover {
    border-color: var(--border);
  }
  .goal-item.done .goal-text {
    text-decoration: line-through;
    color: var(--muted);
  }
  .checkbox-circle {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 1.5px solid var(--border);
    background: var(--surface);
    display: grid;
    place-items: center;
    cursor: pointer;
    flex: none;
    color: var(--accent);
  }
  .goal-item.done .checkbox-circle {
    border-color: var(--ok);
    background: var(--ok);
    color: #fff;
  }
  .goal-text {
    flex: 1;
    font-size: 13.5px;
  }
  .delete-btn {
    border: none;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: grid;
    place-items: center;
  }
  .delete-btn:hover {
    color: var(--danger);
  }

  /* Quick Add Habit Bar */
  .quick-add-habit-card {
    padding: 12px 16px;
    margin-bottom: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .quick-add-input-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .quick-add-input-row input {
    flex: 1;
    min-width: 0;
    font-size: 13.5px;
  }
  .habit-presets-row {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .preset-label {
    font-size: 11.5px;
    font-weight: 600;
    color: var(--muted);
  }
  .preset-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    font-size: 11.5px;
    font-weight: 500;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--text);
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .preset-pill:hover {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent);
    transform: translateY(-1px);
  }
  .preset-plus {
    font-weight: 800;
    font-size: 13px;
    line-height: 1;
  }

  /* Table Grid */
  .habits-table-wrap {
    width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    border-radius: var(--radius);
  }
  .habits-table {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 520px;
  }
  .table-header-row,
  .habit-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px;
  }
  .table-header-row {
    border-bottom: 1px solid var(--border);
    padding-bottom: 8px;
    color: var(--muted);
    font-size: 12px;
    font-weight: 600;
  }
  .habit-row {
    border-radius: 8px;
    transition: background 0.12s;
  }
  .habit-row:hover {
    background: var(--surface-2);
  }

  .col-info {
    flex: 1;
    min-width: 180px;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .habit-icon {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    display: grid;
    place-items: center;
    flex: none;
  }
  .habit-details {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .habit-name {
    font-size: 13.5px;
    font-weight: 600;
  }
  .habit-meta {
    font-size: 11.5px;
    color: var(--muted);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .streak-pill {
    background: var(--surface-2);
    padding: 1px 6px;
    border-radius: 999px;
    border: 1px solid var(--border);
  }

  .col-days {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
  }
  .day-head {
    width: 34px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    font-size: 11px;
  }
  .day-head.today {
    color: var(--accent);
    font-weight: 700;
  }
  .day-bubble {
    width: 34px;
    height: 34px;
    border-radius: 10px;
    border: 1.5px solid var(--border);
    background: var(--surface);
    display: grid;
    place-items: center;
    cursor: pointer;
    transition: all 0.15s;
    flex: none;
  }
  .day-bubble:hover {
    border-color: var(--accent);
    transform: scale(1.05);
  }
  .day-bubble.is-partial {
    border-color: var(--accent);
    color: var(--accent);
  }

  .col-actions {
    width: 30px;
    display: flex;
    justify-content: flex-end;
  }
  .icon-action-btn {
    border: none;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    padding: 6px;
    border-radius: 6px;
    display: grid;
    place-items: center;
  }
  .icon-action-btn:hover {
    color: var(--danger);
  }

  /* Modal */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(2px);
    display: grid;
    place-items: center;
    z-index: 999;
  }
  .modal {
    width: min(440px, 92vw);
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .modal-header h3 {
    margin: 0;
    font-size: 16px;
  }
  .close-btn {
    border: none;
    background: transparent;
    cursor: pointer;
    color: var(--muted);
  }
  .modal-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12.5px;
    color: var(--text);
  }
  .color-picker-row {
    display: flex;
    gap: 8px;
    margin-top: 4px;
  }
  .color-dot {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    transition: transform 0.1s;
  }
  .color-dot.selected {
    border-color: var(--text);
    transform: scale(1.15);
  }
  .icon-picker-row {
    display: flex;
    gap: 6px;
    margin-top: 4px;
  }
  .icon-choice {
    width: 32px;
    height: 32px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--surface);
    display: grid;
    place-items: center;
    cursor: pointer;
    color: var(--text);
  }
  .icon-choice.selected {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }
  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 8px;
  }
</style>
