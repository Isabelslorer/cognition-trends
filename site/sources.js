// Source switch shared by both views: which conversations the dashboard covers
// (all, Claude chats, Claude Code, Claude Design). Views listen for 'miro:source'.
(() => {
  const D = window.MIRO_DASHBOARD_DATA;
  window.MIRO_SOURCE = 'all';
  const bar = document.getElementById('sourceBar');
  const keys = Object.keys(D?.variants || {});
  // "All" plus a single source is the same data twice; no switch needed.
  if (!bar || keys.length <= 2) {
    bar?.remove();
    return;
  }

  bar.innerHTML = `
    <span class="source-switch-label">Conversations from</span>
    <div class="tr-seg">
      ${keys.map((key) => `<button type="button" data-source="${key}" aria-pressed="${key === 'all'}">${escapeHtml(D.variants[key].label)}<span class="tr-count">${D.variants[key].meta.chatCount}</span></button>`).join('')}
    </div>`;

  bar.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-source]');
    if (!button || button.dataset.source === window.MIRO_SOURCE) return;
    window.MIRO_SOURCE = button.dataset.source;
    bar.querySelectorAll('button[data-source]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    window.dispatchEvent(new CustomEvent('miro:source', { detail: { source: window.MIRO_SOURCE } }));
  });

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (match) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[match]));
  }
})();
