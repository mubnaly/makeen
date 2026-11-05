<script>
  import Icon from './Icon.svelte';
  import { t, ui } from '../lib/lang.svelte.js';

  let activeTab = $state('markdown'); // 'markdown' | 'shortcuts' | 'features' | 'backup'
</script>

<div class="guide-workspace">
  <!-- Guide Header -->
  <div class="guide-header">
    <div class="guide-title-row">
      <span class="guide-icon-badge">
        <Icon name="book" size={24} />
      </span>
      <div>
        <h2>{t('guide.title')}</h2>
        <p class="muted" style="margin:2px 0 0 0; font-size:13.5px;">{t('guide.subtitle')}</p>
      </div>
    </div>

    <!-- Navigation Pills -->
    <div class="guide-tabs" role="tablist">
      <button
        class="guide-tab-btn {activeTab === 'markdown' ? 'active' : ''}"
        onclick={() => (activeTab = 'markdown')}
      >
        <Icon name="file-text" size={14} />
        <span>دليل Markdown</span>
      </button>
      <button
        class="guide-tab-btn {activeTab === 'shortcuts' ? 'active' : ''}"
        onclick={() => (activeTab = 'shortcuts')}
      >
        <Icon name="activity" size={14} />
        <span>اختصارات المفاتيح</span>
      </button>
      <button
        class="guide-tab-btn {activeTab === 'features' ? 'active' : ''}"
        onclick={() => (activeTab = 'features')}
      >
        <Icon name="star" size={14} />
        <span>خصائص التطبيق</span>
      </button>
      <button
        class="guide-tab-btn {activeTab === 'backup' ? 'active' : ''}"
        onclick={() => (activeTab = 'backup')}
      >
        <Icon name="database" size={14} />
        <span>النسخ والبيانات</span>
      </button>
    </div>
  </div>

  <!-- TAB 1: MARKDOWN CHEATSHEET -->
  {#if activeTab === 'markdown'}
    <div class="guide-section">
      <div class="card guide-card">
        <h3>دليل استخدام لغة Markdown في مَكِين</h3>
        <p class="muted">
          يدعم محرر مَكِين لغة Markdown الكاملة مع الترقيم التلقائي، وقوائم المهام، والمعادلات الرياضية KaTeX، والتسجيل الصوتي بالذكاء الاصطناعي.
        </p>

        <div class="cheatsheet-grid">
          <div class="cheat-item">
            <div class="cheat-header">العناوين (Headings)</div>
            <div class="cheat-code">
              # عنوان رئيسي ضخم<br/>
              ## عنوان فرعي متوسط<br/>
              ### عنوان فرعي صغير
            </div>
            <div class="cheat-desc">استخدم # متبوعة بمسافة لتحديد مستوى العنوان.</div>
          </div>

          <div class="cheat-item">
            <div class="cheat-header">قوائم المهام التفاعلية (Task Lists)</div>
            <div class="cheat-code">
              - [ ] مهمة لم تكتمل بعد<br/>
              - [x] مهمة تم إنجازها
            </div>
            <div class="cheat-desc">عند الضغط على Enter في نهاية السطر، يُنشئ المحرر تلقائيًا مربع مهمة جديد.</div>
          </div>

          <div class="cheat-item">
            <div class="cheat-header">التنسيق والخطوط (Formatting)</div>
            <div class="cheat-code">
              **نص غامق عريض**<br/>
              *نص مائل إيحائي*<br/>
              ~~نص مشطوب عليه~~<br/>
              `كود برمجي مضمن`
            </div>
          </div>

          <div class="cheat-item">
            <div class="cheat-header">المعادلات الرياضية (LaTeX / KaTeX)</div>
            <div class="cheat-code">
              معادلة مضمنة: $E = mc^2$<br/>
              معادلة مستقلة:<br/>
              {'$$\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}$$'}
            </div>
            <div class="cheat-desc">يدعم KaTeX فوري ومباشر لعرض أروع المعادلات الرياضية والفيزيائية.</div>
          </div>

          <div class="cheat-item">
            <div class="cheat-header">الجداول المنظمة (Tables)</div>
            <div class="cheat-code">
              | الموضوع | الحالة | التقييم |<br/>
              |---|---|---|<br/>
              | الرياضيات | مكتمل | ممتاز |<br/>
              | البرمجة | قيد التعلم | جيد جدًا |
            </div>
          </div>

          <div class="cheat-item">
            <div class="cheat-header">التنبيهات الملونة (Callouts)</div>
            <div class="cheat-code">
              > [!NOTE] ملاحظة هامة<br/>
              > [!TIP] فكرة ذكية لتسريع المذاكرة<br/>
              > [!WARNING] تحذير من خطأ شائع
            </div>
          </div>
        </div>
      </div>
    </div>
  {/if}

  <!-- TAB 2: SHORTCUTS -->
  {#if activeTab === 'shortcuts'}
    <div class="guide-section">
      <div class="card guide-card">
        <h3>اختصارات لوحة المفاتيح الفورية</h3>
        <table class="shortcuts-table">
          <thead>
            <tr>
              <th>المفتاح</th>
              <th>الوظيفة في قارئ الكتب والفيديوهات ومحرر الملاحظات</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><kbd>Space</kbd></td>
              <td>تشغيل / إيقاف الفيديو أو التسجيل الصوتي</td>
            </tr>
            <tr>
              <td><kbd>→</kbd> / <kbd>←</kbd></td>
              <td>تقديم / تأخير 5 ثوانٍ في الفيديو، أو الانتقال بين صفحات الـ PDF</td>
            </tr>
            <tr>
              <td><kbd>Ctrl</kbd> + <kbd>O</kbd></td>
              <td>استيراد ملف PDF فوريًا من جهازك</td>
            </tr>
            <tr>
              <td><kbd>F</kbd></td>
              <td>تفعيل وضع ملء الشاشة الكامل للقارئ أو الفيديو</td>
            </tr>
            <tr>
              <td><kbd>Enter</kbd></td>
              <td>إكمال تلقائي للقوائم النقطية والمهام في محرر Markdown</td>
            </tr>
            <tr>
              <td><kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd></td>
              <td>زيادة أو تقليل المحاذاة الداخلية للنص في المحرر</td>
            </tr>
            <tr>
              <td><kbd>Esc</kbd></td>
              <td>إغلاق النوافذ المنبثقة والخروج من وضع ملء الشاشة</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  {/if}

  <!-- TAB 3: FEATURES -->
  {#if activeTab === 'features'}
    <div class="guide-section">
      <div class="features-grid">
        <div class="card feature-card">
          <div class="feature-icon"><Icon name="dualStudio" size={20} /></div>
          <h4>الاستوديو المزدوج</h4>
          <p>شاشة دراسة متزامنة تجمع بين مشاهدة الفيديو وقراءة كتاب الـ PDF وتدوين الملاحظات بجانبه مع مقسم مرن أفقيًا أو رأسيًا.</p>
        </div>

        <div class="card feature-card">
          <div class="feature-icon"><Icon name="volume" size={20} /></div>
          <h4>الصوت في الخلفية</h4>
          <p>استمع لمحاضرتك في الخلفية أثناء قراءة ملف الـ PDF مع شريط تحكم مصغر مضمن يتيح لك التقديم والتأخير دون مغادرة الكتاب.</p>
        </div>

        <div class="card feature-card">
          <div class="feature-icon"><Icon name="moon" size={20} /></div>
          <h4>مواقيت الصلاة الفلكية</h4>
          <p>مواقيت دقيقة لكافة المدن العربية والإسلامية مع تنبيه قبل الشروق بعشر دقائق، وتنبيه صلاة الضحى بعد الشروق بـ 20 دقيقة.</p>
        </div>

        <div class="card feature-card">
          <div class="feature-icon"><Icon name="flashcards" size={20} /></div>
          <h4>البطاقات والتكرار المتباعد</h4>
          <p>حوّل أي لقطة من كتاب أو فيديو إلى بطاقة مراجعة ذكية بضغطة زر واحدة بنظام Spaced Repetition (SRS) للحفظ طويل الأمد.</p>
        </div>
      </div>
    </div>
  {/if}

  <!-- TAB 4: BACKUP & DATA -->
  {#if activeTab === 'backup'}
    <div class="guide-section">
      <div class="card guide-card">
        <h3>الخصوصية وأمان البيانات والنسخ الاحتياطي</h3>
        <p>
          تطبيق <strong>مَكِين</strong> تطبيق محلي بالكامل (Local-First). جميع كتبك، وفيديوهاتك، وملاحظاتك، وتاريخ عاداتك تُخزن محليًا على قرص جهازك فقط دون رفع أي شيء إلى أي خوادم خارجية.
        </p>
        <div class="data-tips">
          <div class="tip-box">
            <strong>أين تُحفظ البيانات؟</strong>
            <p>تُحفظ ملفاتك وتعليقاتك في مجلد التخزين المحلي الآمن داخل جهازك، وتُدار قاعدة البيانات المدمجة بأعلى درجات الكفاءة والأمان.</p>
          </div>
          <div class="tip-box">
            <strong>النسخ الاحتياطي الشامل (JSON):</strong>
            <p>يمكنك في أي وقت الذهاب إلى <strong>الإعدادات ← النسخ الاحتياطي والبيانات</strong> وتصدير ملف احتياطي كامل بنقرة واحدة لاستعادته متى شئت على أي جهاز آخر.</p>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .guide-workspace {
    max-width: 900px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .guide-header {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .guide-title-row {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .guide-icon-badge {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    background: var(--accent-soft);
    color: var(--accent);
    display: grid;
    place-items: center;
    flex: none;
  }
  .guide-title-row h2 {
    margin: 0;
    font-size: 22px;
    font-weight: 700;
  }

  .guide-tabs {
    display: flex;
    gap: 6px;
    border-bottom: 1px solid var(--border);
    padding-bottom: 8px;
    overflow-x: auto;
  }
  .guide-tab-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 14px;
    border-radius: 8px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--muted);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }
  .guide-tab-btn:hover {
    background: var(--surface-2);
    color: var(--text);
  }
  .guide-tab-btn.active {
    background: var(--surface);
    border-color: var(--border);
    color: var(--accent);
    box-shadow: var(--shadow);
  }

  .guide-card {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .guide-card h3 {
    margin: 0;
    font-size: 17px;
  }

  .cheatsheet-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
    gap: 14px;
  }
  .cheat-item {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .cheat-header {
    font-size: 13px;
    font-weight: 700;
    color: var(--accent);
  }
  .cheat-code {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 10px;
    font-family: monospace;
    font-size: 12.5px;
    direction: ltr;
    text-align: left;
    color: var(--text);
  }
  .cheat-desc {
    font-size: 11.5px;
    color: var(--muted);
  }

  /* Table */
  .shortcuts-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  .shortcuts-table th,
  .shortcuts-table td {
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    text-align: start;
  }
  .shortcuts-table th {
    color: var(--muted);
    font-weight: 600;
  }
  kbd {
    display: inline-block;
    padding: 2px 7px;
    font-size: 11.5px;
    font-family: monospace;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 5px;
    box-shadow: 0 1px 1px rgba(0,0,0,0.1);
  }

  /* Features Grid */
  .features-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 14px;
  }
  .feature-card {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .feature-icon {
    width: 36px;
    height: 36px;
    border-radius: 8px;
    background: var(--accent-soft);
    color: var(--accent);
    display: grid;
    place-items: center;
  }
  .feature-card h4 {
    margin: 0;
    font-size: 15px;
  }
  .feature-card p {
    margin: 0;
    font-size: 12.5px;
    color: var(--muted);
    line-height: 1.5;
  }

  /* Data Tips */
  .data-tips {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .tip-box {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
  }
  .tip-box p {
    margin: 0;
    color: var(--muted);
  }
</style>
