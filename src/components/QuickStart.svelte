<script>
  // First-run guide. It lists the whole study loop as four concrete steps and
  // disappears by itself when they are all done (or when dismissed), so a new
  // user never has to guess where to begin.
  import Icon from './Icon.svelte';
  import { t } from '../lib/lang.svelte.js';

  let { steps = [], progressText = '', ondismiss = null } = $props();

  const firstOpen = $derived(steps.findIndex((step) => !step.done));
</script>

<section class="quickstart card">
  <div class="qs-head">
    <span class="qs-icon" aria-hidden="true"><Icon name="check-square" size={19} /></span>
    <div class="grow">
      <h2 class="qs-title">{t('quickstart.title')}</h2>
      <div class="qs-sub">{t('quickstart.subtitle')}</div>
    </div>
    <span class="qs-progress">{progressText}</span>
    {#if ondismiss}
      <button class="qs-dismiss" onclick={ondismiss} title={t('quickstart.dismiss')} aria-label={t('quickstart.dismiss')}>
        <Icon name="x" size={15} />
      </button>
    {/if}
  </div>

  <ol class="qs-steps">
    {#each steps as step, i (step.key)}
      <li class="qs-step" class:done={step.done}>
        <span class="qs-num" aria-hidden="true">
          {#if step.done}<Icon name="check" size={13} />{:else}{i + 1}{/if}
        </span>
        <div class="qs-text">
          <span class="qs-step-title">{step.title}</span>
          <span class="qs-hint">{step.hint}</span>
        </div>
        {#if step.done}
          <span class="qs-done-label"><Icon name="check" size={13} />{t('common.done')}</span>
        {:else if step.actionLabel && step.onaction}
          <button class:primary={i === firstOpen} onclick={step.onaction}>{step.actionLabel}</button>
        {/if}
      </li>
    {/each}
  </ol>
</section>
