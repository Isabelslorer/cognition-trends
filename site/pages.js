// Pages: one section per screen. The hash names the page (#areas); no hash shows the cover.
// The tabs set the reading order; ‹ › and the arrow keys step through it. "How it's scored" sits
// outside the order. Views render when their page opens, on the 'miro:route' event.
(() => {
  const pages = [...document.querySelectorAll('.page')];
  const nav = document.getElementById('topNav');
  if (!pages.length || !nav) return;

  const pageIds = new Set(pages.map((page) => page.id));
  // Read the tabs each time: trends.js removes "Over time" when the data has no timeline.
  const order = () => ['cover', ...[...nav.querySelectorAll('a')].map((link) => link.hash.slice(1))];
  const current = () => (pageIds.has(location.hash.slice(1)) ? location.hash.slice(1) : 'cover');

  addArrows();
  bindHeader();
  window.addEventListener('hashchange', show);
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.target.closest('input, select, textarea, [contenteditable]')) return;
    if (event.key === 'ArrowRight') go(1);
    else if (event.key === 'ArrowLeft') go(-1);
  });
  show();
  // The hash names a page element, so on load the browser jumps down to it after show() ran; start at the top.
  history.scrollRestoration = 'manual';
  window.addEventListener('load', () => window.scrollTo({ top: 0, behavior: 'instant' }));

  function show() {
    const id = current();
    pages.forEach((page) => { page.hidden = page.id !== id; });
    nav.querySelectorAll('a').forEach((link) => link.classList.toggle('active', link.hash === `#${id}`));
    document.body.dataset.page = id;
    window.scrollTo({ top: 0, behavior: 'instant' });
    window.dispatchEvent(new CustomEvent('miro:route', { detail: id }));
  }

  // Scrolling down hides the tab pill so the content gets the whole screen. It comes back on scroll up,
  // near the top, on a page change, or on keyboard focus.
  function bindHeader() {
    let lastY = window.scrollY;
    window.addEventListener('scroll', () => {
      const y = window.scrollY;
      if (y < 80) document.body.classList.remove('pill-hidden');
      else if (Math.abs(y - lastY) >= 8) document.body.classList.toggle('pill-hidden', y > lastY);
      if (Math.abs(y - lastY) >= 8 || y < 80) lastY = y;
    }, { passive: true });
    window.addEventListener('miro:route', () => { document.body.classList.remove('pill-hidden'); lastY = 0; });
    nav.addEventListener('focusin', () => document.body.classList.remove('pill-hidden'));
  }

  function go(step) {
    const sequence = order();
    const index = sequence.indexOf(current());
    const next = sequence[index + step];
    if (index >= 0 && next) location.hash = next;
  }

  // ‹ title › on every page in the order. The cover has its own Start link.
  function addArrows() {
    pages.forEach((page) => {
      const head = page.querySelector('.sec-head');
      if (!head || !order().includes(page.id)) return;
      const text = document.createElement('div');
      text.className = 'sec-head-text';
      text.append(...head.childNodes);
      head.append(arrow(-1, 'Previous page', '‹'), text, arrow(1, 'Next page', '›'));
      head.classList.add('sec-head-paged');
    });
    updateArrows();
    window.addEventListener('miro:route', updateArrows);
  }

  function arrow(step, label, glyph) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pg-arrow';
    button.dataset.step = step;
    button.setAttribute('aria-label', label);
    button.textContent = glyph;
    button.addEventListener('click', () => go(step));
    return button;
  }

  function updateArrows() {
    const sequence = order();
    document.querySelectorAll('.pg-arrow').forEach((button) => {
      const index = sequence.indexOf(button.closest('.page').id);
      button.disabled = index < 0 || !sequence[index + Number(button.dataset.step)];
    });
  }
})();
