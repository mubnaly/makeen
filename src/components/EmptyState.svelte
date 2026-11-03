<script>
  // One empty state for every screen: a clear reason, a quiet hint and the one
  // action that gets the user unstuck. Without this, empty screens were a line
  // of muted text with nothing to click.
  import Icon from './Icon.svelte';

  let {
    icon = 'library',
    title = '',
    hint = '',
    actionLabel = '',
    onaction = null,
    secondaryLabel = '',
    onsecondary = null
  } = $props();
</script>

<div class="empty-state">
  <span class="es-icon" aria-hidden="true"><Icon name={icon} size={30} /></span>
  <div class="es-title">{title}</div>
  {#if hint}<p class="es-hint">{hint}</p>{/if}
  {#if (actionLabel && onaction) || (secondaryLabel && onsecondary)}
    <div class="es-actions">
      {#if actionLabel && onaction}<button class="primary" onclick={onaction}>{actionLabel}</button>{/if}
      {#if secondaryLabel && onsecondary}<button onclick={onsecondary}>{secondaryLabel}</button>{/if}
    </div>
  {/if}
</div>
