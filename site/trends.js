// "Over time" view: how each kind of work split between you and AI, month by month
// (or quarter by quarter), with all kinds of work on one shared graph. Everything is computed in the
// browser from D.timeline, one row per analyzed chat, so the filters re-slice it without re-running anything.
(() => {
  const D = window.MIRO_DASHBOARD_DATA;
  const MIN_CHATS = 5; // a point needs this many chats where that kind of work happened
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const AREA_LABELS = {
    research: 'Research', writing: 'Writing', coding: 'Coding', design: 'Design',
    studying: 'Studying', career: 'Career', presenting: 'Presenting', personal: 'Personal'
  };
  const OPENING_LABELS = {
    delegation: 'Handed it over', contextualized: 'Gave context first', critique: 'Asked for critique',
    pastein: 'Pasted material', exploration: 'Open exploration'
  };
  const ARC_LABELS = {
    draft_redirect_rebuild: 'Draft, redirect, rebuild', ask_synthesize_decide: 'Ask, synthesize, decide',
    debug_test_fix: 'Debug, test, fix', brainstorm_refine: 'Brainstorm, refine', explain_practice_check: 'Explain, practice, check'
  };
  // Short names for the table columns.
  const SHORT_LABELS = {
    ideas: 'Ideas', direction: 'Direction', research: 'Research',
    building: 'Building', problems: 'Catching problems', final_call: 'Final call',
    checking: 'Checking', understanding: 'Understanding'
  };

  if (!D || !Array.isArray(D.timeline)) {
    document.getElementById('trendsNavLink')?.remove();
    return;
  }

  const SERIES = (D.dimensions || []).map((dimension) => ({
    key: dimension.key,
    label: dimension.label,
    short: SHORT_LABELS[dimension.key] || dimension.label
  }));

  const state = {
    topic: '', // a chat counts for a topic if it is its main or second topic
    opening: 'all',
    arc: 'all',
    grain: 'month',
    table: false
  };

  const view = document.getElementById('trends');
  const chartEl = document.getElementById('trChart');
  const tableEl = document.getElementById('trTable');
  let rendered = false;

  window.addEventListener('miro:route', (event) => { if (event.detail === 'trends') openPage(); });
  window.addEventListener('miro:source', () => {
    if (!rendered) return;
    updateCounts();
    if (!view.hidden) render();
  });
  window.addEventListener('resize', debounce(() => { if (!view.hidden) renderChart(); }, 120));

  // --- opening the page (pages.js routes) ---------------------------------

  function openPage() {
    if (!rendered) {
      renderFilters();
      updateCounts();
      rendered = true;
    }
    render();
  }

  // --- filters -------------------------------------------------------------

  function renderFilters() {
    const topicCounts = countBy(D.timeline.flatMap((row) => row.areas));
    const openingCounts = countBy(D.timeline.map((row) => row.opening));
    const arcCounts = countBy(D.timeline.map((row) => row.arc));

    document.getElementById('trFilters').innerHTML = `
      <div class="tr-filter-group">
        <select class="tr-select" id="trTopic" aria-label="Topic">
          <option value="">All topics</option>
          ${Object.keys(AREA_LABELS).filter((key) => topicCounts[key]).map((key) => `<option value="${key}"></option>`).join('')}
        </select>
        <select class="tr-select" id="trOpening" aria-label="How the chat opened">
          <option value="all">Any opening</option>
          ${Object.keys(OPENING_LABELS).filter((key) => openingCounts[key]).map((key) => `<option value="${key}"></option>`).join('')}
        </select>
        <select class="tr-select" id="trArc" aria-label="How it unfolded">
          <option value="all">Any shape</option>
          ${Object.keys(ARC_LABELS).filter((key) => arcCounts[key]).map((key) => `<option value="${key}"></option>`).join('')}
        </select>
        <span class="tr-summary" id="trSummary"></span>
      </div>
      <div class="tr-filter-group">
        <div class="tr-seg" id="trGrain" role="group" aria-label="Group by">
          <button type="button" data-value="month" aria-pressed="true">Month</button>
          <button type="button" data-value="quarter" aria-pressed="false">Quarter</button>
        </div>
        <button class="tr-toggle" id="trTableToggle" type="button" aria-pressed="false">Show as table</button>
      </div>
    `;

    bindSegment('trGrain', (value) => { state.grain = value; });
    document.getElementById('trTopic').addEventListener('change', (event) => { state.topic = event.target.value; render(); });
    document.getElementById('trOpening').addEventListener('change', (event) => { state.opening = event.target.value; render(); });
    document.getElementById('trArc').addEventListener('change', (event) => { state.arc = event.target.value; render(); });
    const toggle = document.getElementById('trTableToggle');
    toggle.addEventListener('click', () => {
      state.table = !state.table;
      toggle.setAttribute('aria-pressed', String(state.table));
      toggle.textContent = state.table ? 'Show graph' : 'Show as table';
      render();
    });
  }

  function bindSegment(id, apply) {
    const group = document.getElementById(id);
    group.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      apply(button.dataset.value);
      group.querySelectorAll('button').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
      render();
    });
  }

  // --- data ----------------------------------------------------------------

  // Rows from the source chosen in the switch at the top (sources.js).
  function sourceRows() {
    const source = window.MIRO_SOURCE || 'all';
    return source === 'all' ? D.timeline : D.timeline.filter((row) => (row.source || 'claude_ai') === source);
  }

  // Filter counts follow the chosen source so they always match what the chart can show.
  function updateCounts() {
    const rows = sourceRows();
    const topicCounts = countBy(rows.flatMap((row) => row.areas));
    const openingCounts = countBy(rows.map((row) => row.opening));
    const arcCounts = countBy(rows.map((row) => row.arc));
    document.querySelectorAll('#trTopic option[value]:not([value=""])').forEach((option) => {
      option.textContent = `${AREA_LABELS[option.value]} (${topicCounts[option.value] || 0})`;
    });
    document.querySelectorAll('#trOpening option[value]:not([value="all"])').forEach((option) => {
      option.textContent = `${OPENING_LABELS[option.value]} (${openingCounts[option.value] || 0})`;
    });
    document.querySelectorAll('#trArc option[value]:not([value="all"])').forEach((option) => {
      option.textContent = `${ARC_LABELS[option.value]} (${arcCounts[option.value] || 0})`;
    });
  }

  function filteredRows() {
    return sourceRows().filter((row) => {
      if (state.topic && !row.areas.includes(state.topic)) return false;
      if (state.opening !== 'all' && row.opening !== state.opening) return false;
      if (state.arc !== 'all' && row.arc !== state.arc) return false;
      return true;
    });
  }

  // Buckets always span the full history, so filtering never shifts the time axis.
  function buildBuckets(rows) {
    const dates = D.timeline.map((row) => row.date).filter(Boolean).sort();
    const keyOf = (date) => {
      const year = Number(date.slice(0, 4));
      const month = Number(date.slice(5, 7)) - 1;
      return state.grain === 'quarter' ? year * 4 + Math.floor(month / 3) : year * 12 + month;
    };
    const first = keyOf(dates[0]);
    const last = keyOf(dates[dates.length - 1]);
    const buckets = [];
    for (let key = first; key <= last; key += 1) {
      buckets.push({ key, label: bucketLabel(key), rows: [], points: {} });
    }
    for (const row of rows) {
      if (row.date) buckets[keyOf(row.date) - first].rows.push(row);
    }
    for (const bucket of buckets) {
      for (const series of SERIES) {
        const values = bucket.rows.map((row) => row.split[series.key]).filter((value) => Number.isFinite(value));
        bucket.points[series.key] = {
          n: values.length,
          value: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
          ok: values.length >= MIN_CHATS
        };
      }
    }
    return buckets;
  }

  function bucketLabel(key) {
    if (state.grain === 'quarter') {
      const year = Math.floor(key / 4);
      return { short: `Q${(key % 4) + 1}`, year, long: `Q${(key % 4) + 1} ${year}`, isYearStart: key % 4 === 0 };
    }
    const year = Math.floor(key / 12);
    return { short: MONTHS[key % 12], year, long: `${MONTHS[key % 12]} ${year}`, isYearStart: key % 12 === 0 };
  }

  // --- render --------------------------------------------------------------

  function render() {
    const rows = filteredRows();
    const total = sourceRows().length;
    const source = window.MIRO_SOURCE && window.MIRO_SOURCE !== 'all' ? ` ${D.variants?.[window.MIRO_SOURCE]?.label || ''}` : '';
    document.getElementById('trSummary').textContent = rows.length === total
      ? `Showing all ${total}${source} chats.`
      : `Showing ${rows.length} of ${total}${source} chats.`;
    document.getElementById('trFootnote').textContent =
      `Each line tracks one kind of work. Each point is the average for that ${state.grain} across chats where that kind of work happened (0 = AI carried it all, 100 = you did). Bars show total chats per ${state.grain}. ` +
      `Points need at least ${MIN_CHATS} such chats; thinner ${state.grain}s are left as gaps${state.grain === 'month' ? ', and grouping by quarter fills many of them' : ''}. ` +
      `A chat counts for a line only when that kind of work came up at least ${D.reliability?.min_moments || 2} times in it. ` +
      'Months follow the date each chat started. Chats with fewer than 4 messages were not analyzed.' +
      (D.reliability ? ` Agreement (Krippendorff's α; 0.8+ high) was measured by coding ${D.reliability.sample} sample chats twice with the same model and once with each of two models.` : '');
    chartEl.hidden = state.table;
    tableEl.hidden = !state.table;
    if (state.table) renderTable(); else renderChart();
  }

  // One shared graph: all series use the same time and 0–100 axes. A line breaks where
  // a period has fewer than MIN_CHATS relevant chats, rather than joining across a gap.
  function renderChart() {
    const rows = filteredRows();
    chartEl.innerHTML = '';
    if (!rows.length) {
      chartEl.innerHTML = '<div class="tr-empty">No chats match these filters.</div>';
      return;
    }
    const buckets = buildBuckets(rows);
    const chartStyle = getComputedStyle(chartEl);
    const availableWidth = chartEl.clientWidth - parseFloat(chartStyle.paddingLeft) - parseFloat(chartStyle.paddingRight);
    const width = Math.max(600, availableWidth);
    const compact = width < 650;
    const left = compact ? 32 : 42;
    const right = 12;
    const top = 14;
    const bottom = compact ? 210 : 240;
    const axisY = bottom + 24;
    const countTop = axisY + 18;
    const countBottom = countTop + 38;
    const height = countBottom + 8;
    const step = (width - left - right) / Math.max(1, buckets.length - 1);
    const xAt = (index) => left + step * index;
    const yAt = (value) => top + ((100 - value) / 100) * (bottom - top);
    const colors = SERIES.map((_, index) => `var(--tr-series-${index + 1})`);

    const legend = document.createElement('div');
    legend.className = 'tr-legend';
    legend.innerHTML = SERIES.map((series, index) => {
      const chats = rows.filter((row) => Number.isFinite(row.split[series.key])).length;
      return `<span class="tr-legend-item" style="--series-color:${colors[index]}"><i aria-hidden="true"></i>${esc(series.label)}<span class="tr-legend-count">${chats}</span></span>`;
    }).join('');
    chartEl.append(legend);

    const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `How ${SERIES.length} kinds of work split between you and AI over time, grouped by ${state.grain}. Use the table view for exact values.` });
    for (const value of [100, 75, 50, 25, 0]) {
      svg.append(el('line', { x1: left, x2: width - right, y1: yAt(value), y2: yAt(value), class: value === 50 ? 'tr-even-line' : 'tr-grid-line' }));
    }
    svg.append(text(0, yAt(100) + 4, 'You', { class: 'tr-axis' }));
    svg.append(text(0, yAt(50) + 4, 'Even', { class: 'tr-axis' }));
    svg.append(text(0, yAt(0) + 4, 'AI', { class: 'tr-axis' }));

    SERIES.forEach((series, seriesIndex) => {
      const color = colors[seriesIndex];
      const lastIndex = findLastIndex(buckets, (bucket) => bucket.points[series.key].ok);
      let segment = [];
      const flush = () => {
        if (segment.length > 1) svg.append(el('path', {
          d: segment.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(''),
          fill: 'none', stroke: color, 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round'
        }));
        segment = [];
      };
      buckets.forEach((bucket, index) => {
        const point = bucket.points[series.key];
        if (point.ok) segment.push([xAt(index), yAt(point.value)]);
        else flush();
      });
      flush();
      buckets.forEach((bucket, index) => {
        const point = bucket.points[series.key];
        if (!point.ok) return;
        const dot = el('circle', { cx: xAt(index), cy: yAt(point.value), r: index === lastIndex ? 4 : 3, fill: color, stroke: 'var(--surface)', 'stroke-width': 1 });
        const tip = el('title', {});
        tip.textContent = `${series.label} · ${bucket.label.long}: ${Math.round(point.value)} of 100 (${point.n} chats)`;
        dot.append(tip);
        svg.append(dot);
      });
    });

    buckets.forEach((bucket, index) => {
      if (compact && index !== 0 && index !== buckets.length - 1 && !bucket.label.isYearStart) return;
      if (!compact && state.grain === 'month' && index !== 0 && index !== buckets.length - 1 && !bucket.label.isYearStart && index % 3 !== 0) return;
      svg.append(text(xAt(index), axisY, bucket.label.isYearStart || index === 0 || index === buckets.length - 1 ? bucket.label.long : bucket.label.short, {
        class: 'tr-date', 'text-anchor': index === 0 ? 'start' : index === buckets.length - 1 ? 'end' : 'middle'
      }));
    });
    const maxCount = Math.max(1, ...buckets.map((bucket) => bucket.rows.length));
    svg.append(text(0, countBottom - 3, 'Chats', { class: 'tr-axis' }));
    buckets.forEach((bucket, index) => {
      const barHeight = bucket.rows.length / maxCount * 36;
      const bar = el('rect', { x: xAt(index) - Math.min(step * 0.36, 13), y: countBottom - barHeight, width: Math.min(step * 0.72, 26), height: barHeight, rx: 2, class: 'tr-count-bar' });
      const tip = el('title', {});
      tip.textContent = `${bucket.label.long}: ${bucket.rows.length} chats`;
      bar.append(tip);
      svg.append(bar);
    });
    const plot = document.createElement('div');
    plot.className = 'tr-plot-scroll';
    if (width > availableWidth) {
      plot.tabIndex = 0;
      plot.setAttribute('role', 'region');
      plot.setAttribute('aria-label', 'Timeline graph; scroll horizontally for more dates');
    }
    plot.append(svg);
    chartEl.append(plot);
  }

  function renderTable() {
    const rows = filteredRows();
    if (!rows.length) {
      tableEl.innerHTML = '<div class="tr-empty">No chats match these filters.</div>';
      return;
    }
    const buckets = buildBuckets(rows);
    const visible = SERIES;
    tableEl.innerHTML = `
      <table class="tr-table">
        <thead><tr><th>${state.grain === 'month' ? 'Month' : 'Quarter'}</th><th>Chats</th>${visible.map((series) => `<th>${esc(series.short)}</th>`).join('')}</tr></thead>
        <tbody>
          ${buckets.map((bucket) => `<tr>
            <td>${esc(bucket.label.long)}</td>
            <td>${bucket.rows.length}</td>
            ${visible.map((series) => {
              const point = bucket.points[series.key];
              if (!point.n) return '<td class="tr-thin">–</td>';
              return `<td class="${point.ok ? '' : 'tr-thin'}">${Math.round(point.value)}<span class="tr-n">(${point.n})</span></td>`;
            }).join('')}
          </tr>`).join('')}
        </tbody>
      </table>`;
  }

  // --- helpers -------------------------------------------------------------

  function el(name, attributes) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attributes)) {
      if (value !== null && value !== undefined) node.setAttribute(key, value);
    }
    return node;
  }

  function text(x, y, content, attributes = {}) {
    const node = el('text', { x, y, ...attributes });
    node.textContent = content;
    return node;
  }

  function findLastIndex(list, predicate) {
    for (let i = list.length - 1; i >= 0; i -= 1) if (predicate(list[i])) return i;
    return -1;
  }

  function countBy(values) {
    const counts = {};
    for (const value of values) if (value) counts[value] = (counts[value] || 0) + 1;
    return counts;
  }

  function debounce(fn, wait) {
    let timer = null;
    return () => { clearTimeout(timer); timer = setTimeout(fn, wait); };
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (match) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[match]));
  }
})();
