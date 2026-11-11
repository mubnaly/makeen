<!-- src/components/ReminderAlertModal.svelte -->
<script>
  import Icon from './Icon.svelte';
  import { updateCustomReminder } from '../lib/customReminders.js';

  let { alertData = null, onclose = () => {}, onOpenResource = () => {} } = $props();

  function handleSnooze() {
    if (!alertData?.reminder) { onclose(); return; }
    const now = new Date();
    now.setMinutes(now.getMinutes() + 5);
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    updateCustomReminder(alertData.reminder.id, {
      date: dateStr,
      time: timeStr,
      advanceMinutes: 0,
      enabled: true,
      lastNotifiedCycle: ''
    });
    onclose();
  }

  function handleOpenResource() {
    if (alertData?.reminder?.linkedResource) {
      onOpenResource(alertData.reminder.linkedResource);
    }
    onclose();
  }
</script>

{#if alertData && alertData.reminder}
  <div class="alert-backdrop" role="presentation" onclick={onclose}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="reminder-alert-window card" role="alertdialog" aria-modal="true" tabindex="-1" onclick={(e) => e.stopPropagation()}>
      <div class="alert-icon-circle">
        <Icon name="bell" size={24} />
      </div>

      <div class="alert-content">
        <span class="alert-tag">تذكير مَكِين المخصص</span>
        <h3 class="alert-title">{alertData.reminder.title}</h3>
        <p class="alert-time muted hstack" style="gap: 4px; justify-content: center; margin: 4px 0 10px 0;">
          <Icon name="clock" size={14} />
          <span>الموعد: {alertData.reminder.date} الساعة {alertData.reminder.time}</span>
        </p>

        {#if alertData.reminder.notes}
          <div class="alert-notes-box">
            {alertData.reminder.notes}
          </div>
        {/if}

        {#if alertData.reminder.linkedResource}
          <div class="linked-resource-card hstack" style="gap: 8px; justify-content: center; margin-top: 10px; padding: 6px 12px; background: var(--surface-2); border-radius: 6px; border: 1px solid var(--border);">
            <Icon name={alertData.reminder.linkedResource.kind === 'video' ? 'video' : 'reader'} size={15} />
            <span style="font-size: 12.5px; font-weight: 600;">{alertData.reminder.linkedResource.title}</span>
          </div>
        {/if}
      </div>

      <div class="alert-actions hstack" style="gap: 8px; justify-content: center; margin-top: 18px; flex-wrap: wrap;">
        {#if alertData.reminder.linkedResource}
          <button type="button" class="primary hstack" onclick={handleOpenResource}>
            <Icon name="play" size={14} />
            <span>فتح المورد مباشرة</span>
          </button>
        {/if}
        <button type="button" class="small hstack" onclick={handleSnooze}>
          <Icon name="rotate-right" size={13} />
          <span>تأجيل 5 دقائق</span>
        </button>
        <button type="button" class="small" onclick={onclose}>
          تم / إغلاق
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .alert-backdrop {
    position: fixed;
    inset: 0;
    z-index: 10000;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(5px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    animation: fadeIn 0.2s ease-out;
  }
  .reminder-alert-window {
    width: min(450px, 100%);
    text-align: center;
    padding: 24px;
    border-radius: 16px;
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5);
    animation: popIn 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .alert-icon-circle {
    width: 54px;
    height: 54px;
    border-radius: 50%;
    margin: 0 auto 14px auto;
    background: linear-gradient(135deg, #f59e0b, #ef4444);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 15px rgba(245, 158, 11, 0.4);
    animation: pulse 1.8s infinite;
  }
  .alert-tag {
    font-size: 11px;
    font-weight: 700;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .alert-title {
    margin: 6px 0;
    font-size: 18px;
    font-weight: 800;
  }
  .alert-notes-box {
    background: var(--surface-2);
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 12.5px;
    line-height: 1.5;
    text-align: start;
    white-space: pre-wrap;
    border: 1px solid var(--border);
  }
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes popIn {
    from { transform: scale(0.92); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
  }
  @keyframes pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.08); }
  }
</style>
