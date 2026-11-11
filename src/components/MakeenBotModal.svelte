<!-- src/components/MakeenBotModal.svelte -->
<!-- Makeen AI Assistant Chat Interface with Full App Context Awareness -->
<script>
  import { onMount, tick } from 'svelte';
  import Icon from './Icon.svelte';
  import {
    sendAiQuery, executeBotAction, loadChatHistory, saveChatHistory, clearChatHistory,
    getAiApiKey, saveAiApiKey, getAiModel, saveAiModel, AVAILABLE_MODELS, gatherAppContext
  } from '../lib/aiBot.js';
  import { t as tr, ui } from '../lib/lang.svelte.js';

  let {
    onclose = () => {},
    onOpenResource = () => {},
    onNavigate = () => {},
    notify = () => {},
    currentView = 'Today',
    activeDoc = null,
    activeVideo = null,
    activeNote = null,
    videoTime = 0
  } = $props();

  let messages = $state([]);
  let inputQuery = $state('');
  let loading = $state(false);
  let showSettings = $state(false);

  let apiKey = $state(getAiApiKey());
  let currentModel = $state(getAiModel());
  let contextStats = $state(null);
  let messagesContainer = $state(null);

  const viewContext = $derived({
    currentView,
    activeDoc,
    activeVideo,
    activeNote,
    videoTime
  });

  const activeContextLabel = $derived.by(() => {
    if (activeVideo && (currentView === 'Video' || currentView === 'video')) {
      const title = activeVideo.title || activeVideo.name || 'الفيديو';
      return {
        icon: 'video',
        title: `سياق: ${title}`,
        sub: `مشاهدة فيديو (${Math.floor(videoTime)} ث)`
      };
    }
    if (activeDoc && (currentView === 'Reader' || currentView === 'reader')) {
      const title = activeDoc.title || activeDoc.filename || activeDoc.name || 'المستند';
      return {
        icon: 'book',
        title: `سياق: ${title}`,
        sub: `قراءة كتاب PDF (ص ${activeDoc.currentPage || 1})`
      };
    }
    if (currentView === 'Planner') {
      return {
        icon: 'calendar',
        title: 'سياق: المخطط والتقويم',
        sub: 'تنظيم وجدولة المهام والأوقات'
      };
    }
    if (currentView === 'MarkdownEditor') {
      return {
        icon: 'file-text',
        title: activeNote ? `سياق: ${activeNote.title || 'الملاحظة'}` : 'سياق: الملاحظات والملخصات',
        sub: 'محرر الملاحظات الماركدوان'
      };
    }
    if (currentView === 'Community') {
      return {
        icon: 'globe',
        title: 'سياق: المجتمع المفتوح',
        sub: 'استكشاف الكورسات والمواد'
      };
    }
    return {
      icon: 'sparkles',
      title: 'سياق: النظام الشامل',
      sub: 'وصول لكافة ملفاتك ومهامك'
    };
  });

  const contextualPrompts = $derived.by(() => {
    if (activeVideo && (currentView === 'Video' || currentView === 'video')) {
      const vTitle = activeVideo.title || activeVideo.name || 'هذا الفيديو';
      return [
        { label: 'تلخيص هذا الفيديو', prompt: `لخص لي محتوى فيديو "${vTitle}" وأهم النقاط والأفكار الرئيسية فيه باختصار.` },
        { label: 'استخراج أهم النقاط', prompt: `ما هي أهم الفوائد والخطوات العملية التي يمكن تعلمها من فيديو "${vTitle}"؟` },
        { label: 'جدولة وقت للمشاهدة', prompt: `اعمل لي جلسة في المخطط اليوم لمتابعة واستكمال دراسة فيديو "${vTitle}" لمدة 45 دقيقة.` },
        { label: 'إنشاء 3 أسئلة استذكار', prompt: `اصنع لي 3 أسئلة استذكار ذكية (Flashcards) مع الإجابات لاختبار فهمي لموضوع فيديو "${vTitle}".` },
        { label: 'صياغة ملاحظة دراسية', prompt: `اكتب لي مسودة ملاحظة منظمة ومرتبة بعناوين رئيسية وفرعية يمكنني حفظها في ملاحظاتي حول فيديو "${vTitle}".` }
      ];
    }
    if (activeDoc && (currentView === 'Reader' || currentView === 'reader')) {
      const dTitle = activeDoc.title || activeDoc.filename || activeDoc.name || 'هذا الكتاب';
      return [
        { label: 'تلخيص هذا الكتاب', prompt: `أعطني ملخصاً شاملاً عن كتاب "${dTitle}" وأهم موضوعاته وأفكاره.` },
        { label: 'جدولة جلسة قراءة', prompt: `اعمل لي جلسة قراءة لكتاب "${dTitle}" اليوم في المخطط من الساعة 5:00 عصراً إلى 7:00 مساءً.` },
        { label: 'خطة مذاكرة للكتاب', prompt: `اقترح لي خطة دراسية لإنهاء قراءة كتاب "${dTitle}" خلال 10 أيام مع تقسيم الفصول.` },
        { label: 'أسئلة مراجعة سريعة', prompt: `اطرح علي أسئلة ذكية لاختبار فهمي لأهم المفاهيم في كتاب "${dTitle}".` },
        { label: 'استخراج بطاقات Anki', prompt: `استخرج أهم المصطلحات والتعريفات من كتاب "${dTitle}" على شكل بطاقات استذكار سريعة.` }
      ];
    }
    if (currentView === 'Planner') {
      return [
        { label: 'عمل من 9 إلى 2', prompt: 'اعمل لي حدث للشغل في المخطط اليوم من الساعة 9:00 صباحاً إلى 2:00 ظهراً.' },
        { label: 'جلسة مذاكرة من 5 إلى 8', prompt: 'اعمل لي جلسة مذاكرة في المخطط اليوم من 5:00 عصراً إلى 8:00 مساءً مع استراحة قصيرة.' },
        { label: 'ما هي مهامي اليوم؟', prompt: 'ما هي المهام والأحداث المجدولة لليوم في المخطط؟ وما أولوياتها المقترحة؟' },
        { label: 'إضافة تذكير ذكي', prompt: 'أضف تذكير مخصص اليوم الساعة 9:00 مساءً لمراجعة ما أنجزته من مهام.' },
        { label: 'توزيع ساعات المذاكرة', prompt: 'وزع لي ساعات المذاكرة اليوم بناء على الكتب والفيديوهات المتاحة في مكتبتي.' }
      ];
    }
    if (currentView === 'MarkdownEditor') {
      return [
        { label: 'تلخيص ملاحظاتي', prompt: 'لخص لي أهم النقاط والأفكار الرئيسية المكتوبة في ملاحظاتي الحالية باختصار ووضوح.' },
        { label: 'إعادة تنظيم وهيكلة', prompt: 'اقترح لي طريقة احترافية لهيكلة وتنظيم هذه الملاحظات باستخدام عناوين وجداول ونقاط.' },
        { label: 'تحويل لبطاقات حفظ', prompt: 'حول هذه الملاحظات إلى بطاقات مراجعة سريعة (سؤال وجواب) لحفظها في تكرار متباعد.' },
        { label: 'إنشاء تذكير لمراجعتها', prompt: 'أضف تذكير مخصص غداً الساعة 8:00 مساءً لمراجعة هذه الملاحظة.' }
      ];
    }
    return [
      { label: 'عمل من 9 إلى 2', prompt: 'اعمل لي حدث في المخطط للشغل اليوم من 9:00 صباحاً إلى 2:00 ظهراً' },
      { label: 'جلسة قراءة من 5 إلى 8', prompt: 'اعمل لي جلسة قراءة من 5:00 عصراً إلى 8:00 مساءً واربطها بأحد كتب الـ PDF الموجودة' },
      { label: 'تلخيص الملاحظات', prompt: 'ما هي أهم الملاحظات والملخصات المخزنة في التطبيق؟ لخصها لي باختصار' },
      { label: 'فحص الكتب والفيديوهات', prompt: 'أعطني تقريراً عن الكتب والفيديوهات المخزنة حالياً في التطبيق وما تم إنجازه منها' },
      { label: 'تذكير مخصص', prompt: 'أضف تذكير مخصص اليوم الساعة 9:00 مساءً لمراجعة البطاقات والملاحظات' }
    ];
  });

  onMount(async () => {
    messages = loadChatHistory();
    if (messages.length === 0) {
      messages = [
        {
          id: 'welcome',
          role: 'model',
          text: 'مرحباً بك! أنا مساعد مَكِين الذكي.\nأعرف كافة ملفاتك الحالية (كتب PDF، فيديوهات، ملاحظات ماركداون، ومهام المخطط).\n\nيمكنك أن تطلب مني أي شيء مثل:\n• "اعمل لي حدث للشغل من 9 لـ 2"\n• "اعمل جلسة قراءة من 5 لـ 8"\n• "لخص لي ملاحظاتي أو ابحث في كتبي"\n\nكيف يمكنني مساعدتك الآن؟',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          actions: []
        }
      ];
    }

    try {
      const ctx = await gatherAppContext(viewContext);
      contextStats = ctx.stats;
    } catch {}

    scrollToBottom();
  });

  async function scrollToBottom() {
    await tick();
    if (messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  }

  function handleSaveSettings() {
    saveAiApiKey(apiKey);
    saveAiModel(currentModel);
    showSettings = false;
    notify('تم حفظ إعدادات المساعد الذكي', 'ok');
  }

  async function handleSend(customText = null) {
    const textToSend = (customText || inputQuery).trim();
    if (!textToSend || loading) return;

    inputQuery = '';
    const userMsg = {
      id: crypto.randomUUID(),
      role: 'user',
      text: textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    messages = [...messages, userMsg];
    saveChatHistory(messages);
    scrollToBottom();

    loading = true;
    try {
      const res = await sendAiQuery(textToSend, messages, viewContext);
      const modelMsg = {
        id: crypto.randomUUID(),
        role: 'model',
        text: res.text,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        actions: res.actions || []
      };

      // Automatically execute parsed actions
      if (res.actions && res.actions.length > 0) {
        for (const action of res.actions) {
          const actRes = await executeBotAction(action);
          if (actRes.ok) {
            if (action.type === 'create_task') {
              notify(`تمت جدولة الحدث في المخطط: ${action.payload.title}`, 'ok');
            } else if (action.type === 'create_reminder') {
              notify(`تم حفظ التذكير المخصص: ${action.payload.title}`, 'ok');
            }
          }
        }
      }

      messages = [...messages, modelMsg];
      saveChatHistory(messages);
    } catch (err) {
      messages = [...messages, {
        id: crypto.randomUUID(),
        role: 'model',
        text: `حدث خطأ: ${err.message || String(err)}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }];
    } finally {
      loading = false;
      scrollToBottom();
    }
  }

  function handleClear() {
    if (!confirm('هل تريد مسح سجل المحادثة؟')) return;
    clearChatHistory();
    messages = [
      {
        id: crypto.randomUUID(),
        role: 'model',
        text: 'تم مسح المحادثة. كيف يمكنني مساعدتك الآن؟',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
    ];
  }
</script>

<div class="modal-backdrop" onclick={onclose} role="presentation">
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="bot-modal-window card" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
    <!-- Header -->
    <header class="bot-header hstack" style="justify-content: space-between; border-bottom: 1px solid var(--border); padding-bottom: 10px;">
      <div class="hstack" style="gap: 10px;">
        <div class="bot-avatar-badge">
          <Icon name="sparkles" size={18} />
        </div>
        <div>
          <div class="hstack" style="gap: 6px;">
            <h3 style="margin: 0; font-size: 16px;">مساعد مَكِين الذكي (Makeen AI)</h3>
            <span class="badge" style="background: rgba(59, 130, 246, 0.15); color: var(--accent); font-size: 11px;">
              Gemini
            </span>
          </div>
          {#if contextStats}
            <div class="muted" style="font-size: 11.5px; margin-top: 2px;">
              متصل بـ {contextStats.pdfCount} كتاب · {contextStats.videoCount} فيديو · {contextStats.noteCount} ملاحظة · {contextStats.taskCount} مهمة
            </div>
          {/if}
        </div>
      </div>

      <div class="hstack" style="gap: 6px;">
        <button
          type="button"
          class="icon-btn {showSettings ? 'active' : ''}"
          title="إعدادات الموديل والمفتاح"
          onclick={() => showSettings = !showSettings}
        >
          <Icon name="settings" size={16} />
        </button>
        <button type="button" class="icon-btn" title="مسح المحادثة" onclick={handleClear}>
          <Icon name="trash" size={16} />
        </button>
        <button type="button" class="icon-btn" title="إغلاق" onclick={onclose}>
          <Icon name="x" size={16} />
        </button>
      </div>
    </header>

    <!-- Settings Drawer (if toggled) -->
    {#if showSettings}
      <div class="settings-drawer" style="background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-top: 10px;">
        <div class="hstack" style="justify-content: space-between; margin-bottom: 8px;">
          <span style="font-weight: 700; font-size: 13px;" class="hstack">
            <Icon name="sliders" size={14} />
            <span>إعدادات نموذج الذكاء الاصطناعي (Gemini)</span>
          </span>
          <span class="muted" style="font-size: 11px;">Google AI Studio</span>
        </div>
        <div style="margin-bottom: 8px;">
          <label for="ai-model-sel" style="display:block; font-size: 12px; margin-bottom: 4px; font-weight: 600;">النموذج (Model):</label>
          <select id="ai-model-sel" bind:value={currentModel} style="width: 100%; font-size: 12.5px;">
            {#each AVAILABLE_MODELS as m}
              <option value={m.id}>{m.name}</option>
            {/each}
          </select>
        </div>
        <div style="margin-bottom: 10px;">
          <label for="ai-key-inp" style="display:block; font-size: 12px; margin-bottom: 4px; font-weight: 600;">مفتاح Gemini API Key:</label>
          <input
            id="ai-key-inp"
            type="password"
            placeholder="أدخل مفتاحك الخاص أو اتركه للاستخدام الافتراضي"
            bind:value={apiKey}
            style="width: 100%; font-size: 12px; font-family: monospace;"
          />
        </div>
        <div class="hstack" style="justify-content: flex-end; gap: 8px;">
          <button type="button" class="small" onclick={() => showSettings = false}>إلغاء</button>
          <button type="button" class="primary small" onclick={handleSaveSettings}>حفظ الإعدادات</button>
        </div>
      </div>
    {/if}

    <!-- Chat Messages Stream -->
    <div class="chat-messages-container" bind:this={messagesContainer}>
      {#each messages as msg (msg.id)}
        <div class="chat-row {msg.role}">
          <div class="chat-bubble {msg.role}">
            {#if msg.role === 'model'}
              <div class="msg-author-header hstack" style="gap: 4px; margin-bottom: 4px;">
                <Icon name="sparkles" size={13} />
                <span>مساعد مَكِين</span>
                <span class="msg-time">{msg.timestamp}</span>
              </div>
            {:else}
              <div class="msg-author-header user hstack" style="gap: 4px; margin-bottom: 4px; justify-content: flex-end;">
                <span class="msg-time">{msg.timestamp}</span>
                <span>أنت</span>
              </div>
            {/if}

            <div class="msg-content" style="white-space: pre-wrap; line-height: 1.6;">
              {msg.text}
            </div>

            <!-- Action Badges / Cards executed by the bot -->
            {#if msg.actions && msg.actions.length > 0}
              <div class="actions-container" style="margin-top: 8px; display: flex; flex-direction: column; gap: 6px;">
                {#each msg.actions as action}
                  {#if action.type === 'create_task'}
                    <div class="action-card hstack" style="justify-content: space-between; background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.35); border-radius: 6px; padding: 6px 10px;">
                      <div class="hstack" style="gap: 6px; font-size: 12px;">
                        <Icon name="check-square" size={14} style="color: #10b981;" />
                        <span><strong>تمت الجدولة:</strong> {action.payload.title} ({action.payload.startTime} · {action.payload.durationMinutes} دقيقة)</span>
                      </div>
                      <button
                        type="button"
                        class="small"
                        style="padding: 2px 8px; font-size: 11px;"
                        onclick={() => { onclose(); onNavigate('Planner'); }}
                      >
                        عرض في المخطط
                      </button>
                    </div>
                  {:else if action.type === 'create_reminder'}
                    <div class="action-card hstack" style="justify-content: space-between; background: rgba(59, 130, 246, 0.12); border: 1px solid rgba(59, 130, 246, 0.35); border-radius: 6px; padding: 6px 10px;">
                      <div class="hstack" style="gap: 6px; font-size: 12px;">
                        <Icon name="bell" size={14} style="color: var(--accent);" />
                        <span><strong>تم ضبط التذكير:</strong> {action.payload.title} ({action.payload.date} {action.payload.time})</span>
                      </div>
                      <button
                        type="button"
                        class="small"
                        style="padding: 2px 8px; font-size: 11px;"
                        onclick={() => { onclose(); onNavigate('Planner'); }}
                      >
                        عرض التذكيرات
                      </button>
                    </div>
                  {/if}
                {/each}
              </div>
            {/if}
          </div>
        </div>
      {/each}

      {#if loading}
        <div class="chat-row model">
          <div class="chat-bubble model hstack" style="gap: 8px;">
            <Icon name="rotate-right" size={14} class="spin" />
            <span class="muted" style="font-size: 12.5px;">مساعد مَكِين يراجع بياناتك ويصيغ الرد...</span>
          </div>
        </div>
      {/if}
    </div>

    <!-- Active Screen Context Banner -->
    <div class="active-context-pill-banner hstack" style="justify-content: space-between; align-items: center; padding: 6px 12px; background: var(--surface-2); border-radius: 8px; font-size: 11.5px; margin: 4px 0; border: 1px solid var(--border);">
      <div class="hstack" style="gap: 6px; min-width: 0;">
        <span class="context-icon-wrap" style="color: var(--accent); display: flex;">
          <Icon name={activeContextLabel.icon} size={14} />
        </span>
        <strong class="truncate" style="color: var(--text);">{activeContextLabel.title}</strong>
        <span class="muted truncate">({activeContextLabel.sub})</span>
      </div>
      <span class="badge" style="font-size: 10px; padding: 2px 7px; background: rgba(59, 130, 246, 0.12); color: var(--accent); border-radius: 999px; flex-shrink: 0;">
        سياق نشط
      </span>
    </div>

    <!-- Contextual Prompts Row -->
    <div class="quick-prompts-bar hstack" style="gap: 6px; overflow-x: auto; padding: 6px 2px; white-space: nowrap;">
      {#each contextualPrompts as p}
        <button
          type="button"
          class="quick-pill"
          onclick={() => handleSend(p.prompt)}
          disabled={loading}
        >
          {p.label}
        </button>
      {/each}
    </div>

    <!-- Input Footer -->
    <footer class="bot-input-footer hstack" style="gap: 8px; padding-top: 8px; border-top: 1px solid var(--border);">
      <input
        type="text"
        placeholder="اطلب ما تشاء من مساعد مَكِين (مثال: اعمل لي حدث للشغل من 9 لـ 2)..."
        bind:value={inputQuery}
        onkeydown={(e) => { if (e.key === 'Enter') handleSend(); }}
        disabled={loading}
        style="flex: 1; font-size: 13.5px;"
      />
      <button
        type="button"
        class="primary hstack"
        onclick={() => handleSend()}
        disabled={loading || !inputQuery.trim()}
        style="min-width: 80px; justify-content: center;"
      >
        <Icon name="sparkles" size={14} />
        <span>إرسال</span>
      </button>
    </footer>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 999;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }
  .bot-modal-window {
    width: min(720px, 100%);
    height: min(680px, 90vh);
    display: flex;
    flex-direction: column;
    padding: 18px;
    border-radius: 14px;
    box-shadow: 0 20px 45px rgba(0,0,0,0.4);
    background: var(--surface);
    border: 1px solid var(--border);
  }
  .bot-avatar-badge {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: linear-gradient(135deg, #3b82f6, #8b5cf6);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 8px rgba(59, 130, 246, 0.35);
  }
  .chat-messages-container {
    flex: 1;
    overflow-y: auto;
    padding: 12px 4px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .chat-row {
    display: flex;
    width: 100%;
  }
  .chat-row.user {
    justify-content: flex-end;
  }
  .chat-row.model {
    justify-content: flex-start;
  }
  .chat-bubble {
    max-width: 85%;
    padding: 10px 14px;
    border-radius: 12px;
    font-size: 13.5px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  }
  .chat-bubble.user {
    background: var(--accent);
    color: #fff;
    border-bottom-left-radius: 2px;
  }
  .chat-bubble.model {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-bottom-right-radius: 2px;
  }
  .msg-author-header {
    font-size: 11px;
    font-weight: 700;
    opacity: 0.85;
  }
  .msg-time {
    font-size: 10px;
    opacity: 0.65;
    font-weight: normal;
    margin: 0 4px;
  }
  .quick-pill {
    padding: 4px 10px;
    border-radius: 999px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--text);
    font-size: 11.5px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .quick-pill:hover:not(:disabled) {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent);
  }
  .icon-btn.active {
    background: var(--accent-soft);
    color: var(--accent);
  }
</style>
