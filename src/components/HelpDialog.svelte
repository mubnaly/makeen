<script>
  // In-app help: what the app does in three beats, the keyboard shortcuts, and
  // where the user's files live. Focus moves into the dialog on open and goes
  // back to the triggering control on close; Esc is handled by the shell.
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { t } from '../lib/lang.svelte.js';

  let { onclose = null, onshowguide = null } = $props();
  let closeBtn = $state();

  const SECTIONS = [
    { key: 'read', icon: 'reader', title: 'help.readTitle', text: 'help.readText' },
    { key: 'capture', icon: 'gallery', title: 'help.captureTitle', text: 'help.captureText' },
    { key: 'review', icon: 'flashcards', title: 'help.reviewTitle', text: 'help.reviewText' }
  ];
  const SHORTCUTS = [
    { keys: ['Ctrl', 'S'], label: 'help.shortcutSave' },
    { keys: ['Ctrl', 'Z'], label: 'help.shortcutUndo' },
    { keys: ['Ctrl', 'Y'], label: 'help.shortcutRedo' },
    { keys: ['Ctrl', 'O'], label: 'help.shortcutImport' },
    { keys: ['/'], label: 'help.shortcutSearch' },
    { keys: ['?'], label: 'help.shortcutHelp' },
    { keys: ['F'], label: 'help.shortcutFullscreen' },
    { keys: ['Esc'], label: 'help.shortcutClose' }
  ];

  onMount(() => {
    const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Focus lands on Close so a keyboard user is immediately inside the dialog.
    queueMicrotask(() => closeBtn?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      previous?.focus?.();
    };
  });
</script>

<div class="help-backdrop" role="presentation" onclick={onclose}>
  <div class="help-panel" role="dialog" aria-modal="true" aria-labelledby="help-title"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onclose?.(); } }}>
    <div class="help-head">
      <span class="help-ico" aria-hidden="true"><Icon name="help" size={20} /></span>
      <h2 id="help-title">{t('help.title')}</h2>
      <button class="help-close" bind:this={closeBtn} onclick={onclose}
        title={t('common.close')} aria-label={t('common.close')}>
        <Icon name="x" size={17} />
      </button>
    </div>

    <p class="help-intro muted">{t('help.intro')}</p>

    <div class="help-grid">
      {#each SECTIONS as section (section.key)}
        <section class="help-card">
          <span class="help-card-ico" aria-hidden="true"><Icon name={section.icon} size={18} /></span>
          <h3>{t(section.title)}</h3>
          <p class="muted">{t(section.text)}</p>
        </section>
      {/each}
    </div>

    <div class="help-cols">
      <section>
        <h3>{t('help.shortcuts')}</h3>
        <dl class="help-keys">
          {#each SHORTCUTS as shortcut (shortcut.label)}
            <div>
              <dt>{#each shortcut.keys as key, i (key)}{#if i > 0}<span>+</span>{/if}<kbd>{key}</kbd>{/each}</dt>
              <dd>{t(shortcut.label)}</dd>
            </div>
          {/each}
        </dl>
      </section>
      <section>
        <h3>{t('help.dataTitle')}</h3>
        <p class="muted">{t('help.dataText')}</p>
        <p class="help-tip"><Icon name="upload" size={14} />{t('help.dragHint')}</p>
        {#if onshowguide}
          <button class="help-guide-btn" onclick={onshowguide}>
            <Icon name="check-square" size={14} />{t('help.showGuide')}
          </button>
        {/if}
      </section>
    </div>

    <div class="help-actions">
      <button class="primary" onclick={onclose}>{t('common.close')}</button>
    </div>
  </div>
</div>
