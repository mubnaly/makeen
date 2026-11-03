// Thin scrollbars that only show their thumb while the container is actually
// scrolling. CSS cannot observe scroll state, so this action adds a short-lived
// class; the stylesheet keeps the native scrollbar transparent otherwise.
export function autoScrollbar(node, { delay = 750 } = {}) {
  let timer = null;
  node.classList.add('auto-scroll');
  const onScroll = () => {
    node.classList.add('is-scrolling');
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      node.classList.remove('is-scrolling');
      timer = null;
    }, delay);
  };
  node.addEventListener('scroll', onScroll, { passive: true });
  return {
    destroy() {
      node.removeEventListener('scroll', onScroll);
      if (timer) clearTimeout(timer);
    }
  };
}
