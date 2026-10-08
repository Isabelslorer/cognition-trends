// Source dropdown shared by every page: which conversations the dashboard covers
// (all, Claude chats, Claude Code, Claude Design). It sits next to each page's ‹ › arrows; the copies
// stay in sync. Views listen for 'miro:source'.
(() => {
  const D = window.MIRO_DASHBOARD_DATA;
  window.MIRO_SOURCE = 'all';
  const keys = Object.keys(D?.variants || {});
  // "All" plus a single source is the same data twice; no switch needed.
  if (keys.length <= 2) return;

  // After pages.js has laid out the page heads (it runs later in the page).
  document.addEventListener('DOMContentLoaded', () => {
    const selects = [...document.querySelectorAll('.page:not(#cover) .sec-head')].map((head) => {
      const select = document.createElement('select');
      select.className = 'tr-select source-select';
      select.setAttribute('aria-label', 'Which conversations to include');
      select.innerHTML = keys.map((key) => `<option value="${key}">${escapeHtml(D.variants[key].label)} · ${D.variants[key].meta.chatCount}</option>`).join('');
      const arrows = head.querySelector('.pg-arrows');
      if (arrows) arrows.prepend(select);
      else {
        head.classList.add('sec-head-paged');
        head.append(select);
      }
      return select;
    });

    selects.forEach((select) => select.addEventListener('change', () => {
      window.MIRO_SOURCE = select.value;
      selects.forEach((other) => { other.value = select.value; });
      window.dispatchEvent(new CustomEvent('miro:source', { detail: { source: window.MIRO_SOURCE } }));
    }));
  });

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (match) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[match]));
  }
})();
