<script>
  // Renders one monochrome line icon from lib/icons.js. `currentColor` + no
  // colour fills, so icons take the button/text colour in both themes.
  import { ICONS, iconFill } from '../lib/icons.js';

  let { name, size = 18, stroke = 1.7, label = '' } = $props();

  const prims = $derived(ICONS[name] || []);
  const a11y = $derived(
    label
      ? { role: 'img', 'aria-label': label }
      : { 'aria-hidden': 'true', focusable: 'false' }
  );
</script>

<svg
  class="icon"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  {...a11y}
>
  {#each prims as p}
    {#if p[0] === 'path'}
      <path d={p[1]} />
    {:else if p[0] === 'line'}
      <line x1={p[1]} y1={p[2]} x2={p[3]} y2={p[4]} />
    {:else if p[0] === 'circle'}
      <circle cx={p[1]} cy={p[2]} r={p[3]} />
    {:else if p[0] === 'rect'}
      <rect x={p[1]} y={p[2]} width={p[3]} height={p[4]} rx={p[5] ?? 0} />
    {:else if p[0] === 'polyline'}
      <polyline points={p[1]} />
    {:else if p[0] === 'polygon'}
      <polygon points={p[1]} fill={iconFill(p) ? 'currentColor' : 'none'} />
    {/if}
  {/each}
</svg>

<style>
  .icon {
    display: block;
    flex: none;
  }
</style>
