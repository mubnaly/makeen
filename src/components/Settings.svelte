<script>
  // src/components/Settings.svelte — Categorized Settings Workspace for Makeen
  // Features a dedicated categories sidebar with contents shown beside it.

  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { t, ui, setLang } from '../lib/lang.svelte.js';
  import { LANGS } from '../lib/i18n.js';
  import { THEMES, themeLabelKey } from '../lib/themes.js';
  import {
    POPULAR_CITIES,
    loadPrayerSettings,
    savePrayerSettings
  } from '../lib/prayer.js';
  import { AVAILABLE_SOUNDS, playNotificationTone } from '../lib/sound.js';
  import { exportFullBackup, restoreFullBackup } from '../lib/backup.js';
  import { getDailyTemplate, saveDailyTemplate, DEFAULT_DAILY_TEMPLATE } from '../lib/markdownStore.js';
  import { loadTrashRetentionDays, saveTrashRetentionDays, emptyAllTrash } from '../lib/trash.js';
  import { savePdfAutosaveSettings } from '../lib/storage.js';
  import { loadDefaultVideoQuality, saveDefaultVideoQuality, VIDEO_QUALITY_OPTIONS } from '../lib/videoSettings.js';
  import { loadScreenshotResolution, saveScreenshotResolution, SCREENSHOT_RES_OPTIONS } from '../lib/imageQuality.js';
  import PomodoroSoundModal from './PomodoroSoundModal.svelte';
  import { getApiBaseUrl, setApiBaseUrl, checkBackendHealth } from '../lib/api.js';
  import {
    getAiApiKey,
    saveAiApiKey,
    getAiModel,
    saveAiModel,
    AVAILABLE_MODELS,
    DEFAULT_GEMINI_KEY,
    clearChatHistory,
    gatherAppContext,
    sendAiQuery,
    getAiCustomPrePrompt,
    saveAiCustomPrePrompt,
    DEFAULT_PREPROMPT,
    getAiUsageStats
  } from '../lib/aiBot.js';

  let {
    theme = 'midnight',
    setTheme = () => {},
    imageQuality = 80,
    setImageQuality = () => {},
    srsSettings = { intervals: { new: 1, hard: 2, good: 4, easy: 7 }, reminderOn: false, reminderTime: '09:00' },
    persistSrs = () => {},
    toggleDueReminder = () => {},
    testReminder = () => {},
    pdfAutosave = { enabled: true, interval: 15 },
    dueCards = [],
    clearAllData = () => {},
    notify = () => {},
    onBackupRestored = () => {}
  } = $props();

  let activeCategory = $state('general'); // 'general' | 'prayer' | 'habits' | 'markdown' | 'study' | 'backup' | 'about'

  let prayerSettings = $state(loadPrayerSettings());
  let savedLangPref = $state(typeof localStorage !== 'undefined' ? (localStorage.getItem('studyos.lang') || 'system') : 'system');
  let savedThemePref = $state(typeof localStorage !== 'undefined' ? (localStorage.getItem('makeen.theme_pref') || 'system') : 'system');
  let dailyTemplate = $state(getDailyTemplate());
  let videoQuality = $state(loadDefaultVideoQuality());
  let screenshotRes = $state(loadScreenshotResolution());
  let restoreInputEl = $state();
  let isRestoring = $state(false);
  let pomoSoundOpen = $state(false);
  let appStorageFolder = $state('');

  let apiUrlInput = $state(getApiBaseUrl());
  let testingBackend = $state(false);
  let backendHealthStatus = $state(null);

  // AI Assistant Settings State
  let aiApiKey = $state(getAiApiKey());
  let aiModel = $state(getAiModel());
  let aiPrePrompt = $state(getAiCustomPrePrompt());
  let aiUsageStats = $state(getAiUsageStats());
  let showApiKeyText = $state(false);
  let isTestingAi = $state(false);
  let aiTestStatus = $state(null);
  let aiContextStats = $state(null);

  async function handleSaveAiSettings() {
    saveAiApiKey(aiApiKey);
    saveAiModel(aiModel);
    saveAiCustomPrePrompt(aiPrePrompt);
    aiUsageStats = getAiUsageStats();
    notify(t('settings.saved') || 'تم حفظ إعدادات الذكاء الاصطناعي بنجاح', 'ok');
  }

  function handleSavePrePrompt() {
    saveAiCustomPrePrompt(aiPrePrompt);
    notify('تم حفظ التوجيه المسبق للمساعد الذكي بنجاح', 'ok');
  }

  function handleSetSamplePrePrompt() {
    aiPrePrompt = DEFAULT_PREPROMPT;
    saveAiCustomPrePrompt(aiPrePrompt);
    notify('تم تطبيق التوجيه النموذجي المقترح', 'ok');
  }

  function handleClearPrePrompt() {
    aiPrePrompt = '';
    saveAiCustomPrePrompt('');
    notify('تم إفراغ التوجيه المسبق', 'ok');
  }

  function handleResetAiKey() {
    aiApiKey = DEFAULT_GEMINI_KEY;
    saveAiApiKey(DEFAULT_GEMINI_KEY);
    notify('تمت استعادة مفتاح Gemini API الافتراضي بنجاح', 'ok');
  }

  async function handleTestAiConnection() {
    if (!aiApiKey.trim()) {
      notify('يرجى إدخال مفتاح API أولاً', 'error');
      return;
    }
    isTestingAi = true;
    aiTestStatus = null;
    try {
      saveAiApiKey(aiApiKey);
      saveAiModel(aiModel);
      const res = await sendAiQuery('اختبار اتصال سريع بكلمة واحدة: جاهز');
      if (res.error) {
        aiTestStatus = { ok: false, message: res.error };
        notify('فشل اختبار الاتصال: ' + res.error, 'error');
      } else {
        aiTestStatus = { ok: true, message: `متصل بنجاح! الرد: "${res.text}" (النموذج النشط: ${res.model})` };
        notify('تم الاتصال بـ Gemini API بنجاح!', 'ok');
      }
    } catch (e) {
      aiTestStatus = { ok: false, message: e.message || String(e) };
      notify('فشل الاتصال: ' + (e.message || String(e)), 'error');
    } finally {
      isTestingAi = false;
    }
  }

  function handleClearAiChat() {
    if (!confirm('هل تريد مسح سجل محادثات المساعد الذكي بالكامل؟')) return;
    clearChatHistory();
    notify('تم مسح سجل محادثات المساعد الذكي', 'ok');
  }

  async function handleTestDbConnection() {
    testingBackend = true;
    backendHealthStatus = null;
    try {
      setApiBaseUrl(apiUrlInput);
      const res = await checkBackendHealth();
      backendHealthStatus = res;
      if (res.ok) {
        notify('تم الاتصال بخادم PostgreSQL بنجاح!', 'ok');
      } else {
        notify('تعذر الوصول إلى خادم API، تأكد من تشغيل backend أو صحة الرابط', 'warn');
      }
    } catch (e) {
      notify(String(e), 'error');
    } finally {
      testingBackend = false;
    }
  }

  onMount(async () => {
    const bridge = (typeof window !== 'undefined' && (window.makeen || window.studyos)) || null;
    if (bridge?.getAppStorageFolder) {
      try {
        const res = await bridge.getAppStorageFolder();
        if (res && res.folder) {
          appStorageFolder = res.folder;
        }
      } catch {}
    } else if (typeof localStorage !== 'undefined') {
      appStorageFolder = localStorage.getItem('makeen:storage_folder') || 'Documents/Makeen';
    }

    try {
      const ctx = await gatherAppContext();
      aiContextStats = ctx.stats;
    } catch {}
  });

  async function handlePickStorageFolder() {
    const bridge = (typeof window !== 'undefined' && (window.makeen || window.studyos)) || null;
    if (bridge?.pickAppStorageFolder) {
      try {
        const res = await bridge.pickAppStorageFolder();
        if (res && res.ok && res.folder) {
          appStorageFolder = res.folder;
          notify(t('settings.saved') || 'تم تحديث مجلد التخزين بنجاح', 'ok');
        }
      } catch (err) {
        notify(String(err), 'error');
      }
    } else {
      const custom = prompt('حدد مسار المجلد المفضل لحفظ فيديوهات وبيانات مكين:', appStorageFolder);
      if (custom && custom.trim()) {
        appStorageFolder = custom.trim();
        localStorage.setItem('makeen:storage_folder', appStorageFolder);
        notify(t('settings.saved') || 'تم حفظ المسار', 'ok');
      }
    }
  }

  async function handleOpenStorageFolder() {
    const bridge = (typeof window !== 'undefined' && (window.makeen || window.studyos)) || null;
    if (bridge?.openAppStorageFolder) {
      bridge.openAppStorageFolder();
    } else {
      notify('متاح في نسخة الديسكتوب لفتح المجلد مباشرة في مستكشف الملفات', 'info');
    }
  }

  const CATEGORIES = [
    { id: 'general', labelKey: 'settings.catGeneral', icon: 'globe' },
    { id: 'ai', labelKey: 'settings.catAi', icon: 'sparkles' },
    { id: 'prayer', labelKey: 'settings.catPrayer', icon: 'moon' },
    { id: 'habits', labelKey: 'settings.catHabits', icon: 'check' },
    { id: 'markdown', labelKey: 'settings.catMarkdown', icon: 'file-text' },
    { id: 'study', labelKey: 'settings.catStudy', icon: 'flashcards' },
    { id: 'backup', labelKey: 'settings.catBackup', icon: 'database' },
    { id: 'about', labelKey: 'settings.catAbout', icon: 'star' }
  ];

  function handleSaveDailyTemplate() {
    saveDailyTemplate(dailyTemplate);
    notify(t('settings.saved') || 'Saved', 'ok');
  }

  function handleResetDailyTemplate() {
    dailyTemplate = DEFAULT_DAILY_TEMPLATE;
    saveDailyTemplate(dailyTemplate);
    notify(t('settings.saved') || 'Saved', 'ok');
  }

  async function handleFileRestore(e) {
    const file = e.target?.files?.[0];
    if (!file) return;
    isRestoring = true;
    try {
      const res = await restoreFullBackup(file);
      notify(t('backup.success') || 'Backup restored successfully!', 'ok');
      onBackupRestored?.(res);
      setTimeout(() => {
        globalThis.location?.reload();
      }, 1000);
    } catch (err) {
      notify(`${t('backup.invalid') || 'Invalid backup file'} (${err.message})`, 'error');
    } finally {
      isRestoring = false;
      if (restoreInputEl) restoreInputEl.value = '';
    }
  }
</script>

<div class="settings-workspace">
  <!-- Internal Settings Sidebar -->
  <aside class="settings-sidebar card">
    <div class="settings-sidebar-title">
      <Icon name="sliders" size={16} />
      <span>{t('settings.title')}</span>
    </div>
    <div class="categories-list" role="tablist">
      {#each CATEGORIES as cat}
        <button
          type="button"
          class="cat-btn {activeCategory === cat.id ? 'active' : ''}"
          onclick={() => (activeCategory = cat.id)}
        >
          <Icon name={cat.icon} size={15} />
          <span>{t(cat.labelKey)}</span>
        </button>
      {/each}
    </div>
  </aside>

  <!-- Settings Category Content -->
  <main class="settings-content">
    <!-- 1. GENERAL & THEMES -->
    {#if activeCategory === 'general'}
      <div class="card settings-section-card">
        <h3>{t('settings.catGeneral')}</h3>

        <div class="section-title" style="margin-top:0;">{t('settings.language')}</div>
        <div class="hstack" style="gap:10px;">
          <Icon name="globe" size={16} />
          <select
            value={savedLangPref}
            onchange={(e) => {
              savedLangPref = e.currentTarget.value;
              setLang(savedLangPref);
              notify(t('settings.saved') || 'Saved', 'ok');
            }}
            aria-label={t('settings.language')}
          >
            <option value="system">{ui.lang === 'ar' ? 'تلقائي (حسب نظام الجهاز)' : 'System Default'}</option>
            {#each LANGS as l}<option value={l.code}>{l.label}</option>{/each}
          </select>
          <span class="muted" style="font-size:12px">{t('settings.languageHelp')}</span>
        </div>

        <div class="section-title mt">{t('settings.videoQuality')}</div>
        <div class="hstack" style="gap:10px; flex-wrap:wrap;">
          <Icon name="video" size={16} />
          <select
            value={videoQuality}
            onchange={(e) => {
              videoQuality = e.currentTarget.value;
              saveDefaultVideoQuality(videoQuality);
              notify(t('settings.saved') || 'Saved', 'ok');
            }}
            aria-label={t('settings.videoQuality')}
          >
            {#each VIDEO_QUALITY_OPTIONS as opt}
              <option value={opt.id}>{ui.lang === 'ar' ? opt.labelAr : opt.labelEn}</option>
            {/each}
          </select>
          <span class="muted" style="font-size:12px">{t('settings.videoQualityHint')}</span>
        </div>

        <div class="section-title mt">{t('settings.appearance')}</div>
        <p class="muted" style="font-size:13px">{t('settings.themeHint')}</p>

        <!-- System Default Theme Option Card -->
        <div class="system-theme-toggle hstack card" style="padding:12px; margin-bottom:14px; justify-content:space-between; background:var(--surface-2); border-radius:8px; border:1px solid var(--border);">
          <div>
            <div style="font-weight:600; font-size:13px;">{ui.lang === 'ar' ? 'السمة التلقائية حسب نظام الجهاز' : 'Match System Theme'}</div>
            <div class="muted" style="font-size:11.5px; margin-top:2px;">{ui.lang === 'ar' ? 'تبديل المظهر تلقائياً بين الفاتح والداكن وفقاً لإعدادات جهازك' : 'Automatically switch light and dark modes based on OS settings'}</div>
          </div>
          <button
            type="button"
            class="toggle-btn {savedThemePref === 'system' ? 'active' : ''}"
            onclick={() => {
              savedThemePref = savedThemePref === 'system' ? theme : 'system';
              setTheme(savedThemePref);
              notify(t('settings.saved') || 'Saved', 'ok');
            }}
            style="padding:6px 14px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; background:{savedThemePref === 'system' ? 'var(--accent)' : 'var(--surface)'}; color:{savedThemePref === 'system' ? '#fff' : 'var(--text)'}; border:1px solid var(--border);"
          >
            {savedThemePref === 'system' ? (ui.lang === 'ar' ? 'مُفعّل' : 'Enabled') : (ui.lang === 'ar' ? 'تعيين كسمة النظام' : 'Use System')}
          </button>
        </div>

        {#each ['light', 'dark'] as mode}
          <div class="theme-group-label">{mode === 'light' ? t('settings.lightThemes') : t('settings.darkThemes')}</div>
          <div class="theme-grid">
            {#each THEMES.filter((th) => th.mode === mode) as th (th.id)}
              <button
                class="theme-card"
                class:active={savedThemePref !== 'system' && theme === th.id}
                aria-pressed={savedThemePref !== 'system' && theme === th.id}
                style={`--sw-bg:${th.bg}; --sw-surface:${th.surface}; --sw-accent:${th.accent}`}
                onclick={() => {
                  savedThemePref = th.id;
                  setTheme(th.id);
                }}
                title={t(themeLabelKey(th.id))}
              >
                <span class="theme-preview" aria-hidden="true">
                  <span class="theme-dot"></span>
                  <span class="theme-line"></span>
                  <span class="theme-line short"></span>
                </span>
                <span class="theme-name">{t(themeLabelKey(th.id))}</span>
              </button>
            {/each}
          </div>
        {/each}

        <!-- Makeen Storage Folder Section -->
        <div class="section-title mt" style="display:flex; align-items:center; gap:8px;">
          <Icon name="folder" size={16} />
          <span>{ui.lang === 'ar' ? 'مجلد تطبيق مكين وحفظ الفيديوهات والبيانات' : 'Makeen App Data & Storage Folder'}</span>
        </div>
        <p class="muted" style="font-size:12.5px; margin:4px 0 10px;">
          {ui.lang === 'ar'
            ? 'المجلد الذي يحفظ فيه التطبيق الفيديوهات المسجلة، واللقطات الملتقطة، والملفات المصدرة، وملاحظاتك.'
            : 'The folder where Makeen saves screen recordings, captures, exported files, and local data.'}
        </p>
        <div class="card" style="padding:12px 14px; background:var(--surface-2); border:1px solid var(--border); border-radius:8px;">
          <div class="hstack" style="gap:10px; flex-wrap:wrap; align-items:center; justify-content:space-between;">
            <div style="flex:1; min-width:220px;">
              <div class="mono" style="font-size:12.5px; font-weight:600; direction:ltr; text-align:start; word-break:break-all; color:var(--accent);">
                {appStorageFolder || 'Documents/Makeen'}
              </div>
              <small class="muted">{ui.lang === 'ar' ? 'المجلدات الفرعية: Recordings (التسجيلات), Screenshots (اللقطات), Exports (الملفات المصدرة)' : 'Subfolders: Recordings, Screenshots, Exports, Annotations'}</small>
            </div>
            <div class="hstack" style="gap:8px;">
              <button type="button" class="primary small hstack" onclick={handlePickStorageFolder}>
                <Icon name="pencil" size={13} />
                <span>{ui.lang === 'ar' ? 'تغيير المجلد' : 'Change Folder'}</span>
              </button>
              <button type="button" class="secondary small hstack" onclick={handleOpenStorageFolder} title="فتح في مستكشف ويندوز">
                <Icon name="folder" size={13} />
                <span>{ui.lang === 'ar' ? 'فتح المجلد' : 'Open Folder'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    {/if}

    <!-- 2. AI ASSISTANT & GEMINI API SETTINGS -->
    {#if activeCategory === 'ai'}
      <div class="card settings-section-card">
        <div class="hstack" style="justify-content:space-between; flex-wrap:wrap; gap:8px;">
          <div>
            <h3 style="margin:0;" class="hstack">
              <Icon name="sparkles" size={18} />
              <span>{ui.lang === 'ar' ? 'إعدادات الذكاء الاصطناعي (Gemini API)' : 'AI Assistant Settings (Gemini API)'}</span>
            </h3>
            <p class="muted" style="font-size:13px; margin:4px 0 0 0;">
              {ui.lang === 'ar'
                ? 'تخصيص المفتاح والنموذج المشغل لمساعد مَكِين الذكي، وتجربة الاتصال بـ Google Gemini API.'
                : 'Configure API key and model powering Makeen AI Assistant, and test Google Gemini connection.'}
            </p>
          </div>
          {#if aiContextStats}
            <div class="hstack" style="gap:6px; font-size:11.5px; background:var(--surface-2); padding:4px 10px; border-radius:999px; border:1px solid var(--border);">
              <span class="hstack" style="gap:3px;"><Icon name="reader" size={11} /> {aiContextStats.pdfCount} كتب</span>
              <span>·</span>
              <span class="hstack" style="gap:3px;"><Icon name="video" size={11} /> {aiContextStats.videoCount} فيديو</span>
              <span>·</span>
              <span class="hstack" style="gap:3px;"><Icon name="file-text" size={11} /> {aiContextStats.noteCount} ملاحظات</span>
            </div>
          {/if}
        </div>

        <!-- Model Picker -->
        <div class="section-title mt">{ui.lang === 'ar' ? 'نموذج الذكاء الاصطناعي النشط' : 'Active Gemini Model'}</div>
        <div style="margin-bottom:12px;">
          <select bind:value={aiModel} onchange={handleSaveAiSettings} style="width:100%; max-width:480px;">
            {#each AVAILABLE_MODELS as m}
              <option value={m.id}>{m.name}</option>
            {/each}
          </select>
          <small class="muted" style="display:block; margin-top:4px;">
            {ui.lang === 'ar'
              ? 'النموذج الافتراضي 3.5 Flash فائق السرعة، مع ميزة التبديل والاحتياط التلقائي في حال وجود ضغط على أي نموذج.'
              : 'Default 3.5 Flash provides optimal speed and reliability with automatic fallback if servers face peak demand.'}
          </small>
        </div>

        <!-- API Key Configuration -->
        <div class="section-title mt">{ui.lang === 'ar' ? 'مفتاح Gemini API Key' : 'Gemini API Key'}</div>
        <div class="field-col" style="max-width:560px;">
          <div class="hstack" style="gap:8px; width:100%;">
            {#if showApiKeyText}
              <input
                type="text"
                bind:value={aiApiKey}
                placeholder="AIzaSy... أو مفتاحك الخاص"
                style="flex:1; font-family:monospace; font-size:12px;"
              />
            {:else}
              <input
                type="password"
                bind:value={aiApiKey}
                placeholder="AIzaSy... أو مفتاحك الخاص"
                style="flex:1; font-family:monospace; font-size:12px;"
              />
            {/if}
            <button
              type="button"
              class="secondary small hstack"
              onclick={() => (showApiKeyText = !showApiKeyText)}
              title={showApiKeyText ? 'إخفاء المفتاح' : 'إظهار المفتاح'}
            >
              <Icon name={showApiKeyText ? 'eye-slash' : 'eye'} size={14} />
            </button>
            <button
              type="button"
              class="primary small hstack"
              onclick={handleSaveAiSettings}
            >
              <Icon name="check" size={13} />
              <span>{ui.lang === 'ar' ? 'حفظ' : 'Save'}</span>
            </button>
          </div>

          <div class="hstack" style="gap:8px; margin-top:8px; flex-wrap:wrap;">
            <button
              type="button"
              class="secondary small hstack"
              onclick={handleTestAiConnection}
              disabled={isTestingAi}
            >
              {#if isTestingAi}
                <Icon name="rotate-right" size={13} class="spin" />
                <span>{ui.lang === 'ar' ? 'جارِ فحص الاتصال...' : 'Testing...'}</span>
              {:else}
                <Icon name="sparkles" size={13} />
                <span>{ui.lang === 'ar' ? 'فحص واختبار الاتصال' : 'Test API Connection'}</span>
              {/if}
            </button>

            <button
              type="button"
              class="secondary small hstack"
              onclick={handleResetAiKey}
              title="استعادة المفتاح الافتراضي المدمج"
            >
              <Icon name="rotate-left" size={13} />
              <span>{ui.lang === 'ar' ? 'استعادة المفتاح الافتراضي' : 'Reset to Default Key'}</span>
            </button>

            <button
              type="button"
              class="danger small hstack"
              onclick={handleClearAiChat}
              title="مسح سجل المحادثات السابقة"
            >
              <Icon name="trash" size={13} />
              <span>{ui.lang === 'ar' ? 'مسح سجل المحادثات' : 'Clear Chat History'}</span>
            </button>
          </div>

          {#if aiTestStatus}
            <div
              class="test-status-banner hstack"
              style="margin-top:10px; padding:8px 12px; border-radius:8px; font-size:12.5px; {aiTestStatus.ok ? 'background:rgba(48,209,88,0.12); border:1px solid var(--ok); color:var(--ok);' : 'background:rgba(255,69,58,0.12); border:1px solid var(--danger); color:var(--danger);'}"
            >
              <Icon name={aiTestStatus.ok ? 'check' : 'x'} size={15} />
              <span>{aiTestStatus.message}</span>
            </div>
          {/if}

          <!-- Custom Pre-Prompt / System Directives -->
          <div class="section-title mt" style="margin-top:16px;">{ui.lang === 'ar' ? 'التوجيه المسبق للمساعد الذكي (Pre-Prompt)' : 'Custom AI Pre-Prompt Directives'}</div>
          <p class="muted" style="font-size:12px; margin:2px 0 8px 0;">
            {ui.lang === 'ar'
              ? 'تعليمات دائمة يتم دمجها تلقائياً مع كل استفسار لتوجيه المساعد بطريقتك المفضلة (مثل تلخيص الفيديو مع أمثلة عملية ونصائح إضافية).'
              : 'Custom persistent instructions prepended to every AI query (e.g. summarize videos with practical examples and extra tips).'}
          </p>
          <textarea
            bind:value={aiPrePrompt}
            rows="3"
            placeholder="مثال: لخص هذا الفيديو واعطني اهم النقاط والأمثلة التي ذكرت وارشاد او نصيحة او معلومة اضافية من عندك..."
            style="width:100%; font-size:12.5px; line-height:1.5; padding:8px 10px; border-radius:6px; box-sizing:border-box;"
          ></textarea>
          <div class="hstack" style="gap:8px; margin-top:6px; flex-wrap:wrap;">
            <button type="button" class="primary small hstack" onclick={handleSavePrePrompt}>
              <Icon name="check" size={13} />
              <span>{ui.lang === 'ar' ? 'حفظ التوجيه' : 'Save Pre-Prompt'}</span>
            </button>
            <button type="button" class="secondary small hstack" onclick={handleSetSamplePrePrompt}>
              <Icon name="sparkles" size={13} />
              <span>{ui.lang === 'ar' ? 'تطبيق توجيه نموذجي' : 'Apply Sample'}</span>
            </button>
            {#if aiPrePrompt}
              <button type="button" class="small hstack" onclick={handleClearPrePrompt}>
                <Icon name="x" size={13} />
                <span>{ui.lang === 'ar' ? 'إفراغ' : 'Clear'}</span>
              </button>
            {/if}
          </div>

          <!-- API Usage & Token Consumption Quota Meter -->
          <div class="section-title mt" style="margin-top:16px;">{ui.lang === 'ar' ? 'استهلاك الحصة والرموز (API Quota & Token Meter)' : 'API Quota & Token Meter'}</div>
          <div class="card" style="margin-top:6px; padding:12px 14px; background:var(--surface-2); border-radius:8px; border:1px solid var(--border);">
            <div class="hstack" style="justify-content:space-between; margin-bottom:8px;">
              <span style="font-weight:600; font-size:12.5px;">{ui.lang === 'ar' ? 'الاستهلاك اليومي للاستعلامات' : 'Daily Requests Usage'}</span>
              <span class="badge" style="font-size:11px; font-weight:700;">{aiUsageStats.queriesToday} / {aiUsageStats.limitRpd} طلب اليوم</span>
            </div>
            
            <div style="background:var(--surface); height:8px; border-radius:999px; overflow:hidden; border:1px solid var(--border); margin-bottom:10px;">
              <div style="background:var(--accent); height:100%; width:{Math.min(100, Math.round((aiUsageStats.queriesToday / aiUsageStats.limitRpd) * 100))}%; transition: width 0.3s ease;"></div>
            </div>

            <div class="hstack" style="justify-content:space-between; font-size:11.5px; color:var(--muted); flex-wrap:wrap; gap:8px;">
              <div>
                <strong>المتبقي اليوم:</strong> {Math.max(0, aiUsageStats.limitRpd - aiUsageStats.queriesToday)} طلب متاح
              </div>
              <div>
                <strong>الرموز التقديرية:</strong> ~{aiUsageStats.estimatedTokensToday.toLocaleString()} توكن
              </div>
              <div>
                <strong>إجمالي الطلبات:</strong> {aiUsageStats.totalQueries}
              </div>
              <div>
                <strong>حد السرعة:</strong> {aiUsageStats.limitRpm} طلب/دقيقة (1M TPM)
              </div>
            </div>
          </div>

          <div class="card" style="margin-top:14px; padding:12px; background:var(--surface-2); border-radius:8px; font-size:12px; line-height:1.6; color:var(--muted);">
            <div style="font-weight:700; color:var(--text); margin-bottom:4px;">{ui.lang === 'ar' ? 'كيفية الحصول على مفتاح مجاني؟' : 'How to get a free API Key?'}</div>
            {ui.lang === 'ar'
              ? 'يمكنك إنشاء مفتاح API مجاني تماماً وسريع من Google AI Studio عبر الرابط: aistudio.google.com واستخدامه في مكين بدون أي قيود.'
              : 'You can create a 100% free API key from Google AI Studio at aistudio.google.com and use it in Makeen without restrictions.'}
          </div>
        </div>
      </div>
    {/if}
    {#if activeCategory === 'prayer'}
      <div class="card settings-section-card">
        <h3>{t('settings.catPrayer')}</h3>
        <p class="muted" style="font-size:13px;">{t('settings.prayerHelp')}</p>

        <!-- Toggle to show/hide prayer card on the home screen -->
        <label class="hstack mt card" style="cursor:pointer; gap:12px; margin-bottom:14px; padding:12px; background:var(--surface-2); border-radius:8px; border:1px solid var(--border);">
          <input
            type="checkbox"
            checked={prayerSettings.showPrayerCard !== false}
            onchange={(e) => {
              prayerSettings = savePrayerSettings({ showPrayerCard: e.currentTarget.checked });
              notify(t('settings.saved'), 'ok');
            }}
          />
          <div>
            <div style="font-weight:600; font-size:13px;">{ui.lang === 'ar' ? 'عرض مواقيت الصلاة والتقويم الهجري في الصفحة الرئيسية' : 'Show Prayer Times & Hijri Calendar on Home Page'}</div>
            <div class="muted" style="font-size:11.5px; margin-top:2px;">{ui.lang === 'ar' ? 'يمكنك تفعيل أو إلغاء ظهور بطاقة مواقيت الصلاة في الصفحة الرئيسية' : 'Toggle visibility of the prayer times banner on your main dashboard'}</div>
          </div>
        </label>

        <!-- City & Region Picker -->
        <div class="section-title mt">{t('settings.prayerCity')}</div>
        <div class="hstack" style="gap:10px;">
          <Icon name="globe" size={16} />
          <select
            value={prayerSettings.cityId}
            onchange={(e) => {
              prayerSettings = savePrayerSettings({ cityId: e.currentTarget.value });
              notify(t('settings.saved'), 'ok');
            }}
          >
            {#each POPULAR_CITIES as city (city.id)}
              <option value={city.id}>
                {ui.lang === 'ar' ? `${city.nameAr} (${city.countryAr})` : `${city.nameEn} (${city.countryEn})`}
              </option>
            {/each}
          </select>
        </div>

        <!-- Pre-prayer Alert Notification -->
        <div class="section-title mt">{t('settings.prayerReminder')}</div>
        <label class="checkbox-label" style="display:flex; align-items:center; gap:8px;">
          <input
            type="checkbox"
            checked={prayerSettings.reminderEnabled}
            onchange={(e) => {
              prayerSettings = savePrayerSettings({ reminderEnabled: e.currentTarget.checked });
              notify(t('settings.saved'), 'ok');
            }}
          />
          <span>{t('settings.prayerReminder')}</span>
        </label>

        {#if prayerSettings.reminderEnabled}
          <div class="hstack mt" style="gap:10px;">
            <span>{t('settings.prayerReminderTime')}:</span>
            <select
              value={prayerSettings.reminderMinutes}
              onchange={(e) => {
                prayerSettings = savePrayerSettings({ reminderMinutes: Number(e.currentTarget.value) });
                notify(t('settings.saved'), 'ok');
              }}
            >
              <option value="3">3 {t('common.minutes')}</option>
              <option value="5">5 {t('common.minutes')}</option>
              <option value="10">10 {t('common.minutes')}</option>
              <option value="15">15 {t('common.minutes')}</option>
            </select>
          </div>
        {/if}

        <!-- Islamic Alerts Rules Box -->
        <div class="islamic-rules-box mt">
          <div class="rule-row">
            <span class="rule-tag">الشروق</span>
            <span>تنبيه قبل شروق الشمس بـ 10 دقائق لتدارك صلاة الصبح إن لم تكن قد صليتها.</span>
          </div>
          <div class="rule-row">
            <span class="rule-tag">صلاة الضحى</span>
            <span>تنبيه عند حلول موعد صلاة الضحى (بعد شروق الشمس بـ 20 دقيقة وحتى قبل الظهر).</span>
          </div>
        </div>

        <!-- Sound Tone Selection -->
        <div class="section-title mt">{t('settings.prayerSound')}</div>
        <div class="hstack" style="gap:10px; flex-wrap:wrap;">
          <Icon name="bell" size={16} />
          <select
            value={prayerSettings.soundTone}
            onchange={(e) => {
              prayerSettings = savePrayerSettings({ soundTone: e.currentTarget.value });
              playNotificationTone(e.currentTarget.value);
              notify(t('settings.saved'), 'ok');
            }}
          >
            {#each AVAILABLE_SOUNDS as s (s.id)}
              <option value={s.id}>{ui.lang === 'ar' ? s.nameAr : s.nameEn}</option>
            {/each}
          </select>
          <button onclick={() => playNotificationTone(prayerSettings.soundTone)}>
            <Icon name="bell" size={13} />
            <span>{t('settings.testSound')}</span>
          </button>
        </div>
      </div>
    {/if}

    <!-- 3. HABITS & GOALS -->
    {#if activeCategory === 'habits'}
      <div class="card settings-section-card">
        <h3>{t('settings.catHabits')}</h3>
        <p class="muted" style="font-size:13px;">{t('habits.subtitle')}</p>
        <div class="tip-box mt">
          <strong>تلميح العادات والأهداف اليومية:</strong>
          <p>
            يمكنك تتبع العادات اليومية وأهداف اليوم في قسم <strong>العادات</strong> في القائمة الجانبية. ترتبط العادات أيضًا تلقائيًا بملاحظتك اليومية (D-M-YYYY.md) لتنظيم إنجازك دون أي تشتيت.
          </p>
        </div>
      </div>
    {/if}

    <!-- 4. MARKDOWN & DAILY NOTES -->
    {#if activeCategory === 'markdown'}
      <div class="card settings-section-card">
        <h3>{t('settings.catMarkdown')}</h3>
        <p class="muted" style="font-size:13px;">{t('settings.dailyTemplateHelp')}</p>

        <div class="section-title mt">{t('settings.dailyTemplate')}</div>
        <textarea
          class="template-textarea"
          rows="12"
          bind:value={dailyTemplate}
          dir="rtl"
        ></textarea>
        <div class="hstack mt" style="gap:8px;">
          <button class="primary small" onclick={handleSaveDailyTemplate}>
            <Icon name="check" size={13} />
            <span>{t('common.save')}</span>
          </button>
          <button class="small" onclick={handleResetDailyTemplate}>
            <span>{t('settings.dailyTemplateReset')}</span>
          </button>
        </div>
      </div>
    {/if}

    <!-- 5. STUDY & SRS & PDF -->
    {#if activeCategory === 'study'}
      <div class="card settings-section-card">
        <h3>{t('settings.catStudy')}</h3>

        <div class="section-title" style="margin-top:0;">{t('settings.captures')}</div>
        <p class="muted" style="font-size:13px">{t('settings.imageQualityHelp')}</p>
        <div class="quality-row">
          <input
            type="range"
            min="10"
            max="100"
            step="1"
            value={imageQuality}
            aria-label={t('settings.imageQuality')}
            oninput={(e) => setImageQuality(e.currentTarget.value)}
          />
          <span class="quality-value">{imageQuality}%</span>
        </div>
        <div class="hstack" style="gap:6px; margin-top:6px;">
          <button type="button" class="small {imageQuality == 60 ? 'primary' : 'secondary'}" onclick={() => setImageQuality(60)}>
            {ui.lang === 'ar' ? 'اقتصادي (خفيف)' : 'Eco (60%)'}
          </button>
          <button type="button" class="small {imageQuality == 80 ? 'primary' : 'secondary'}" onclick={() => setImageQuality(80)}>
            {ui.lang === 'ar' ? 'متوازن (موصى به)' : 'Medium / Balanced (80%)'}
          </button>
          <button type="button" class="small {imageQuality == 100 ? 'primary' : 'secondary'}" onclick={() => setImageQuality(100)}>
            {ui.lang === 'ar' ? 'عالي الدقة (HD)' : 'High / HD (100%)'}
          </button>
        </div>

        <div class="section-title mt">{ui.lang === 'ar' ? 'دقة التقاط لقطات الفيديو (Resolution)' : 'Video Screenshot Capture Resolution'}</div>
        <p class="muted" style="font-size:13px">
          {ui.lang === 'ar'
            ? 'تحديد أبعاد حفظ لقطات الفيديو (افتراضياً 360p متوسطة الدقة تلقائياً حتى لو كان الفيديو يعمل بدقة 144p أو 1440p).'
            : 'Default capture dimensions for video screenshots (standard 360p medium quality by default even for 144p or 1440p videos).'}
        </p>
        <div class="hstack" style="gap:10px; flex-wrap:wrap;">
          <Icon name="camera" size={16} />
          <select
            value={screenshotRes}
            onchange={(e) => {
              screenshotRes = saveScreenshotResolution(e.currentTarget.value);
              notify(t('settings.saved') || 'Saved', 'ok');
            }}
            aria-label="Screenshot Resolution"
          >
            {#each SCREENSHOT_RES_OPTIONS as opt}
              <option value={opt.id}>{ui.lang === 'ar' ? opt.labelAr : opt.labelEn}</option>
            {/each}
          </select>
        </div>

        <div class="section-title mt">{t('settings.srs')}</div>
        <p class="muted" style="font-size:13px">{t('settings.srsHelp')}</p>
        {#each ['new', 'hard', 'good', 'easy'] as level}
          <div class="hstack" style="margin:4px 0">
            <span style="flex:1">{t(`flashcards.${level}`)}</span>
            <input
              type="number"
              min="1"
              max="365"
              style="width:84px"
              value={srsSettings.intervals[level]}
              onchange={(e) => persistSrs({ intervals: { ...srsSettings.intervals, [level]: e.currentTarget.value } })}
            />
            <span class="muted" style="font-size:12px">{t('common.day')}</span>
          </div>
        {/each}

        <div class="section-title mt">{t('settings.reminder')}</div>
        <label class="hstack" style="gap:8px">
          <input type="checkbox" checked={srsSettings.reminderOn} onchange={toggleDueReminder} />
          <span>{t('settings.reminderToggle')}</span>
        </label>
        <div class="hstack mt">
          <span>{t('settings.time')}</span>
          <input type="time" value={srsSettings.reminderTime} onchange={(e) => persistSrs({ reminderTime: e.currentTarget.value })} />
          <button onclick={testReminder}>{t('settings.testReminder')}</button>
        </div>

        <div class="section-title mt">{t('settings.pdfAutosave')}</div>
        <label class="checkbox-label" style="display:flex; align-items:center; gap:8px;">
          <input
            type="checkbox"
            checked={pdfAutosave.enabled}
            onchange={(e) => {
              pdfAutosave.enabled = e.currentTarget.checked;
              savePdfAutosaveSettings(pdfAutosave);
              notify(t('settings.saved'), 'ok');
            }}
          />
          <span>{t('settings.pdfAutosaveToggle')}</span>
        </label>
        {#if pdfAutosave.enabled}
          <div class="hstack" style="gap:8px; margin-top:8px;">
            <span style="font-size:13px;">{ui.lang === 'ar' ? 'تكرار الحفظ التلقائي:' : 'Autosave Frequency:'}</span>
            <input
              type="number"
              min="1"
              max="60"
              style="width:70px;"
              value={pdfAutosave.interval || 15}
              onchange={(e) => {
                pdfAutosave.interval = Math.max(1, Number(e.currentTarget.value) || 15);
                savePdfAutosaveSettings(pdfAutosave);
                notify(t('settings.saved'), 'ok');
              }}
            />
            <span class="muted" style="font-size:12px;">{ui.lang === 'ar' ? 'دقائق' : 'minutes'}</span>
          </div>
        {/if}

        <div class="section-title mt">{t('pomodoro.soundOptions')}</div>
        <p class="muted" style="font-size:13px">{t('pomodoro.soundSettings')}</p>
        <div class="hstack mt" style="gap:10px;">
          <button class="primary" onclick={() => (pomoSoundOpen = true)}>
            <Icon name="volume" size={15} />
            <span>{t('pomodoro.soundOptions')}</span>
          </button>
        </div>

        <PomodoroSoundModal bind:open={pomoSoundOpen} />
      </div>
    {/if}

    <!-- 6. BACKUP & DATABASE -->
    {#if activeCategory === 'backup'}
      <div class="card settings-section-card">
        <h3>{t('settings.catBackup')}</h3>
        <p class="muted" style="font-size:13px;">{t('backup.help')}</p>

        <div class="backup-actions-grid mt">
          <div class="backup-action-box">
            <Icon name="download" size={20} />
            <div>
              <strong>{t('backup.exportBtn')}</strong>
              <p class="muted" style="font-size:12px; margin:2px 0 0 0;">
                تحميل نسخة كاملة لكل محتوياتك لحفظها بأمان على قرصك الخارجي.
              </p>
            </div>
            <button class="primary small" onclick={exportFullBackup}>
              <Icon name="download" size={13} />
              <span>تصدير الآن</span>
            </button>
          </div>

          <div class="backup-action-box">
            <Icon name="upload" size={20} />
            <div>
              <strong>{t('backup.importBtn')}</strong>
              <p class="muted" style="font-size:12px; margin:2px 0 0 0;">
                استعادة نسخة احتياطية سابقة من ملف JSON مع استرجاع كامل الملاحظات والإعدادات.
              </p>
            </div>
            <button class="small" onclick={() => restoreInputEl?.click()} disabled={isRestoring}>
              <Icon name="upload" size={13} />
              <span>{isRestoring ? 'جارٍ الاستعادة...' : 'اختيار ملف الاستعادة'}</span>
            </button>
            <input
              bind:this={restoreInputEl}
              type="file"
              accept=".json"
              onchange={handleFileRestore}
              style="display:none;"
            />
          </div>
        </div>

        <div class="section-title mt">{t('settings.trash')}</div>
        <div class="hstack" style="gap:10px; margin-bottom:8px">
          <span>{t('settings.autoPurgeAfter')}:</span>
          <select
            value={loadTrashRetentionDays()}
            onchange={(e) => {
              saveTrashRetentionDays(Number(e.currentTarget.value));
              notify(t('settings.saved'), 'ok');
            }}
          >
            <option value="7">7 {t('common.days')}</option>
            <option value="14">14 {t('common.days')}</option>
            <option value="30">30 {t('common.days')} ({t('settings.default')})</option>
            <option value="60">60 {t('common.days')}</option>
            <option value="90">90 {t('common.days')}</option>
            <option value="0">{t('settings.never')}</option>
          </select>
        </div>
        <button
          onclick={() => {
            if (confirm(t('trash.confirmEmptyAll'))) {
              emptyAllTrash();
              notify(t('trash.emptiedAll'), 'ok');
            }
          }}
        >
          <Icon name="trash" size={14} />
          <span>{t('trash.emptyAll')}</span>
        </button>

        <div class="section-title mt">خادم قاعدة البيانات الحقيقية (PostgreSQL Server)</div>
        <p class="muted" style="font-size:13px; margin:2px 0 10px;">
          اربط التطبيق بخادم PostgreSQL سحابي أو محلي لمزامنة الكورسات والمسارات والمشاركات بين جميع أجهزتك والطلاب.
        </p>
        <div class="hstack" style="gap:8px; flex-wrap:wrap;">
          <input
            type="url"
            placeholder="http://localhost:4000/api"
            bind:value={apiUrlInput}
            style="flex:1; min-width:240px; font-size:12.5px;"
          />
          <button class="primary small hstack" onclick={handleTestDbConnection} disabled={testingBackend}>
            {#if testingBackend}
              <Icon name="rotate-right" size={13} class="spin" />
              <span>جارِ الفحص...</span>
            {:else}
              <Icon name="check" size={13} />
              <span>حفظ وفحص الاتصال</span>
            {/if}
          </button>
        </div>
        {#if backendHealthStatus}
          <div class="db-status-banner hstack mt" style="padding:8px 12px; border-radius:6px; font-size:12px; gap:8px; background:{backendHealthStatus.ok ? 'rgba(39, 174, 96, 0.15)' : 'rgba(239, 68, 68, 0.15)'}; color:{backendHealthStatus.ok ? '#27ae60' : '#ef4444'};">
            <Icon name={backendHealthStatus.ok ? 'check' : 'x'} size={14} />
            <span>
              {backendHealthStatus.ok ? `متصل بنجاح: ${backendHealthStatus.data?.database?.db || 'PostgreSQL DB'} (${backendHealthStatus.data?.service || 'Makeen API'})` : 'الخادم غير متاح حالياً (يتم استخدام قاعدة البيانات المحلية IndexedDB تلقائياً)'}
            </span>
          </div>
        {/if}

        <div class="section-title mt">{t('settings.data')}</div>
        <p class="muted" style="font-size:13px">{t('settings.dataHelp')}</p>
        <button class="danger" onclick={clearAllData}>{t('settings.clearData')}</button>
      </div>
    {/if}

    <!-- 7. ABOUT MAKEEN -->
    {#if activeCategory === 'about'}
      <div class="card settings-section-card about-card">
        <div class="about-hero">
          <div class="about-logo">
            <img src="/makeen.png" alt="Makeen" onerror={(e) => (e.currentTarget.style.display = 'none')} />
          </div>
          <h2>{ui.lang === 'ar' ? 'مَكِين' : 'Makeen'}</h2>
          <p class="tagline">{ui.lang === 'ar' ? 'مساحتك الشخصية لتطوير ذاتك وتنظيم دراستك' : 'Your personal workspace for self-growth and focused learning'}</p>
          <span class="version-badge">الإصدار 0.1.0 · Desktop Edition</span>
        </div>

        <div class="about-details">
          <div class="about-item">
            <strong>الخصوصية والأمان المطلق</strong>
            <p>لا حسابات، لا رفع على الإنترنت، ولا تعقب. جميع بياناتك تبقى على هذا الجهاز فقط.</p>
          </div>
          <div class="about-item">
            <strong>أداء فائق وسرعة لا نهائية</strong>
            <p>مبني على أحدث التقنيات مع دعم كامل للعمل بلا اتصال بالإنترنت (Offline-First).</p>
          </div>
        </div>
      </div>
    {/if}
  </main>
</div>

<style>
  .settings-workspace {
    display: grid;
    grid-template-columns: 220px 1fr;
    gap: 16px;
    align-items: start;
    max-width: 960px;
    margin: 0 auto;
  }

  .settings-sidebar {
    padding: 12px 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .settings-sidebar-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13.5px;
    font-weight: 700;
    padding: 6px 8px 10px;
    border-bottom: 1px solid var(--border);
    color: var(--accent);
  }

  .categories-list {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .cat-btn {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 8px 10px;
    border-radius: 8px;
    border: none;
    background: transparent;
    color: var(--muted);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    text-align: start;
    transition: all 0.12s;
  }
  .cat-btn:hover {
    background: var(--surface-2);
    color: var(--text);
  }
  .cat-btn.active {
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 600;
  }

  .settings-content {
    min-width: 0;
  }
  .settings-section-card {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .settings-section-card h3 {
    margin: 0;
    font-size: 17px;
    font-weight: 700;
  }

  .template-textarea {
    width: 100%;
    font-family: inherit;
    font-size: 13.5px;
    line-height: 1.6;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface-2);
    color: var(--text);
    resize: vertical;
  }

  .islamic-rules-box {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 12.5px;
  }
  .rule-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .rule-tag {
    background: var(--accent-soft);
    color: var(--accent);
    padding: 2px 8px;
    border-radius: 6px;
    font-weight: 700;
    font-size: 11.5px;
    flex: none;
  }

  .backup-actions-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .backup-action-box {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  /* About */
  .about-card {
    text-align: center;
    align-items: center;
  }
  .about-hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  .about-logo {
    width: 72px;
    height: 72px;
    border-radius: 18px;
    overflow: hidden;
    margin-bottom: 6px;
    background: var(--accent);
  }
  .about-logo img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .about-hero h2 {
    margin: 0;
    font-size: 24px;
    color: var(--accent);
  }
  .tagline {
    margin: 0;
    font-size: 14px;
    color: var(--muted);
  }
  .version-badge {
    display: inline-block;
    background: var(--surface-2);
    border: 1px solid var(--border);
    padding: 3px 10px;
    border-radius: 999px;
    font-size: 11.5px;
    color: var(--muted);
    margin-top: 4px;
  }
  .about-details {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    width: 100%;
    margin-top: 14px;
    text-align: start;
  }
  .about-item {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px;
    font-size: 12.5px;
  }
  .about-item p {
    margin: 4px 0 0 0;
    color: var(--muted);
  }
  /* Mobile layout & screen adaptation */
  @media (max-width: 768px) {
    .settings-workspace {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 0;
    }
    .settings-sidebar {
      padding: 6px 8px;
      border-radius: var(--radius);
      width: 100%;
      max-width: 100%;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
    }
    .settings-sidebar-title {
      display: none;
    }
    .categories-list {
      display: flex;
      flex-direction: row;
      flex-wrap: nowrap;
      overflow-x: auto;
      scrollbar-width: none;
      -webkit-overflow-scrolling: touch;
      gap: 6px;
      padding: 2px;
      width: max-content;
      min-width: 100%;
    }
    .categories-list::-webkit-scrollbar {
      display: none;
    }
    .cat-btn {
      flex: none;
      white-space: nowrap;
      padding: 6px 12px;
      border-radius: 999px;
      font-size: 12px;
      background: var(--surface-2);
    }
    .cat-btn.active {
      background: var(--accent);
      color: #fff;
    }
    .settings-section-card {
      padding: 14px;
      border-radius: var(--radius);
    }
    .backup-actions-grid {
      grid-template-columns: 1fr;
    }
    .about-details {
      grid-template-columns: 1fr;
    }
  }
</style>
