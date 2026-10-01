// "Over time" view: how each kind of work split between you and AI, month by month
// (or quarter by quarter). Everything is computed in the browser from D.timeline,
// one row per analyzed chat, so the filters re-slice it without re-running anything.
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
  // Short names for the lines; color follows the dimension, never its rank.
  const SHORT_LABELS = {
    ideas: 'Ideas', direction: 'Direction', research: 'Research',
    building: 'Building', problems: 'Catching problems', final_call: 'Final call',
    checking: 'Checking', understanding: 'Understanding'
  };

  if (!D || !Array.isArray(D.timeline)) {
    document.getElementById('trendsNavLink')?.remove();
    return;
  }

  const SERIES = (D.dimensions || []).map((dimension, index) => ({
    key: dimension.key,
    label: dimension.label,
    short: SHORT_LABELS[dimension.key] || dimension.label,
    color: `var(--tr-series-${index + 1})`
  }));

  const state = {
    topics: new Set(),
    topicMatch: 'any',
    opening: 'all',
    arc: 'all',
    grain: 'month',
    hidden: new Set(),
    table: false
  };

  const overview = document.getElementById('viewOverview');
  const view = document.getElementById('viewTrends');
  const chartEl = document.getElementById('trChart');
  const tableEl = document.getElementById('trTable');
  const navLink = document.getElementById('trendsNavLink');
  let rendered = false;

  window.addEventListener('hashchange', applyRoute);
  window.addEventListener('miro:source', () => {
    if (!rendered) return;
    updateCounts();
    if (!view.hidden) render();
  });
  window.addEventListener('resize', debounce(() => { if (!view.hidden) renderChart(); }, 120));
  applyRoute();

  // --- routing -------------------------------------------------------------

  function applyRoute() {
    const showTrends = location.hash === '#trends';
    overview.hidden = showTrends;
    view.hidden = !showTrends;
    document.querySelectorAll('.tb-nav a').forEach((link) => link.classList.toggle('active', showTrends ? link === navLink : false));
    if (showTrends) {
      if (!rendered) {
        renderFilters();
        updateCounts();
        renderLegend();
        bindTableToggle();
        rendered = true;
      }
      render();
      window.scrollTo({ top: 0 });
    } else if (location.hash) {
      // The overview was hidden when the browser tried to jump, so jump now.
      document.getElementById(location.hash.slice(1))?.scrollIntoView();
    }
  }

  // --- filters -------------------------------------------------------------

  function renderFilters() {
    const topicCounts = countBy(D.timeline.flatMap((row) => row.areas));
    const topics = Object.keys(AREA_LABELS).filter((key) => topicCounts[key]);
    const openingCounts = countBy(D.timeline.map((row) => row.opening));
    const arcCounts = countBy(D.timeline.map((row) => row.arc));

    document.getElementById('trFilters').innerHTML = `
      <div class="tr-field">
        <div class="tr-field-label">Topic</div>
        <div class="tr-chips" id="trTopics">
          <button class="tr-chip" type="button" data-topic="" aria-pressed="true">All topics</button>
          ${topics.map((key) => `<button class="tr-chip" type="button" data-topic="${key}" aria-pressed="false">${esc(AREA_LABELS[key])}<span class="tr-count">${topicCounts[key]}</span></button>`).join('')}
        </div>
      </div>
      <div class="tr-field">
        <div class="tr-field-label">Topic counts if it's the</div>
        <div class="tr-seg" id="trMatch">
          <button type="button" data-value="any" aria-pressed="true">Main or second topic</button>
          <button type="button" data-value="main" aria-pressed="false">Main topic only</button>
        </div>
      </div>
      <label class="tr-field">
        <span class="tr-field-label">How the chat opened</span>
        <select class="tr-select" id="trOpening">
          <option value="all">Any opening</option>
          ${Object.keys(OPENING_LABELS).filter((key) => openingCounts[key]).map((key) => `<option value="${key}">${esc(OPENING_LABELS[key])} (${openingCounts[key]})</option>`).join('')}
        </select>
      </label>
      <label class="tr-field">
        <span class="tr-field-label">How it unfolded</span>
        <select class="tr-select" id="trArc">
          <option value="all">Any shape</option>
          ${Object.keys(ARC_LABELS).filter((key) => arcCounts[key]).map((key) => `<option value="${key}">${esc(ARC_LABELS[key])} (${arcCounts[key]})</option>`).join('')}
        </select>
      </label>
      <div class="tr-field">
        <div class="tr-field-label">Group by</div>
        <div class="tr-seg" id="trGrain">
          <button type="button" data-value="month" aria-pressed="true">Month</button>
          <button type="button" data-value="quarter" aria-pressed="false">Quarter</button>
        </div>
      </div>
    `;
    const summary = document.createElement('div');
    summary.className = 'tr-summary';
    summary.id = 'trSummary';
    document.getElementById('trFilters').after(summary);

    document.getElementById('trTopics').addEventListener('click', (event) => {
      const chip = event.target.closest('.tr-chip');
      if (!chip) return;
      const topic = chip.dataset.topic;
      if (!topic) state.topics.clear();
      else if (state.topics.has(topic)) state.topics.delete(topic);
      else state.topics.add(topic);
      document.querySelectorAll('#trTopics .tr-chip').forEach((button) => {
        const key = button.dataset.topic;
        button.setAttribute('aria-pressed', String(key ? state.topics.has(key) : state.topics.size === 0));
      });
      render();
    });
    bindSegment('trMatch', (value) => { state.topicMatch = value; });
    bindSegment('trGrain', (value) => { state.grain = value; });
    document.getElementById('trOpening').addEventListener('change', (event) => { state.opening = event.target.value; render(); });
    document.getElementById('trArc').addEventListener('change', (event) => { state.arc = event.target.value; render(); });
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

  function renderLegend() {
    const legend = document.getElementById('trLegend');
    legend.innerHTML = SERIES.map((series) => `
      <button type="button" data-key="${series.key}" aria-pressed="true" title="Show or hide ${esc(series.label)}">
        <span class="tr-key" style="background:${series.color}"></span>${esc(series.label)}
      </button>`).join('');
    legend.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      const key = button.dataset.key;
      if (state.hidden.has(key)) state.hidden.delete(key);
      else state.hidden.add(key);
      button.setAttribute('aria-pressed', String(!state.hidden.has(key)));
      render();
    });
  }

  function bindTableToggle() {
    const toggle = document.getElementById('trTableToggle');
    toggle.addEventListener('click', () => {
      state.table = !state.table;
      toggle.setAttribute('aria-pressed', String(state.table));
      toggle.textContent = state.table ? 'Show as chart' : 'Show as table';
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
    document.querySelectorAll('#trTopics .tr-chip[data-topic]').forEach((chip) => {
      const count = chip.querySelector('.tr-count');
      if (count) count.textContent = topicCounts[chip.dataset.topic] || 0;
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
      if (state.topics.size) {
        const candidates = state.topicMatch === 'main' ? row.areas.slice(0, 1) : row.areas;
        if (!candidates.some((area) => state.topics.has(area))) return false;
      }
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
      `Each point is the average for that ${state.grain} across chats where that kind of work happened (0 = AI carried it all, 100 = you did). ` +
      `Points need at least ${MIN_CHATS} such chats; thinner ${state.grain}s are left as gaps${state.grain === 'month' ? ', and grouping by quarter fills many of them' : ''}. ` +
      `A chat counts for a line only when that kind of work came up at least ${D.reliability?.min_moments || 2} times in it. ` +
      'Months follow the date each chat started. Chats with fewer than 4 messages were not analyzed.' +
      (D.reliability ? ` Agreement (Krippendorff's α; 0.8+ high) was measured by coding ${D.reliability.sample} sample chats twice with the same model and once with each of two models.` : '');
    renderNotes(rows);
    chartEl.hidden = state.table;
    tableEl.hidden = !state.table;
    if (state.table) renderTable(); else renderChart();
  }

  // One line of context per visible series: how many chats in the current view it rests on,
  // and how repeatable the coding was in the eval (D.reliability, from npm run eval -- --real).
  function renderNotes(rows) {
    const reliability = D.reliability;
    const word = (alpha) => (alpha >= 0.8 ? 'high' : alpha >= 0.667 ? 'moderate' : 'low');
    document.getElementById('trNotes').innerHTML = SERIES.filter((series) => !state.hidden.has(series.key)).map((series) => {
      const chats = rows.filter((row) => Number.isFinite(row.split[series.key])).length;
      const measured = reliability?.dimensions?.[series.key];
      const parts = [`${chats} chat${chats === 1 ? '' : 's'} in this view`];
      if (chats < 30) parts.push('few chats, read with care');
      if (measured?.repeat) parts.push(`re-run agreement ${word(measured.repeat.alpha)} (α ${measured.repeat.alpha.toFixed(2)})`);
      else if (reliability) parts.push('repeatability not measured (too few test chats)');
      if (measured?.cross) parts.push(`model-to-model agreement ${word(measured.cross.alpha)} (α ${measured.cross.alpha.toFixed(2)})`);
      return `<li><span class="tr-key" style="background:${series.color}"></span><span><strong>${esc(series.short)}:</strong> ${esc(parts.join(' · '))}</span></li>`;
    }).join('');
  }

  function renderChart() {
    const rows = filteredRows();
    chartEl.innerHTML = '';
    if (!rows.length) {
      chartEl.innerHTML = '<div class="tr-empty">No chats match these filters.</div>';
      return;
    }
    const buckets = buildBuckets(rows);
    const visible = SERIES.filter((series) => !state.hidden.has(series.key));
    if (!buckets.some((bucket) => visible.some((series) => bucket.points[series.key].ok))) {
      chartEl.innerHTML = `<div class="tr-empty">${rows.length} chat${rows.length === 1 ? '' : 's'} match, but no ${state.grain} has ${MIN_CHATS} or more to plot a point.${state.grain === 'month' ? ' Try grouping by quarter, or' : ' Try'} widening the filters, or use the table view.</div>`;
      return;
    }

    const width = Math.max(320, chartEl.clientWidth);
    const compact = width < 560;
    const margin = { top: 14, right: compact ? 16 : 150, bottom: 30, left: 50 };
    const plotHeight = compact ? 240 : 320;
    const stripGap = 34;
    const stripHeight = 54;
    const height = margin.top + plotHeight + margin.bottom + stripGap + stripHeight + 22;
    const plotWidth = width - margin.left - margin.right;
    const step = plotWidth / buckets.length;
    const xAt = (index) => margin.left + step * (index + 0.5);
    const yAt = (value) => margin.top + ((100 - value) / 100) * plotHeight;
    const plotBottom = margin.top + plotHeight;
    const stripTop = plotBottom + margin.bottom + stripGap;

    const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': 'Line chart of how each kind of work split between you and AI over time. Use the table view for exact values.' });

    // Y grid: You at the top, AI at the bottom, an even split in the middle.
    for (const value of [0, 25, 50, 75, 100]) {
      svg.append(el('line', {
        x1: margin.left, x2: margin.left + plotWidth, y1: yAt(value), y2: yAt(value),
        stroke: value === 50 ? 'var(--tr-axis)' : 'var(--tr-grid)', 'stroke-width': 1,
        'stroke-dasharray': value === 50 ? '4 4' : null
      }));
    }
    svg.append(text(margin.left - 10, yAt(100) + 4, 'You', { 'text-anchor': 'end', class: 'tr-axis-strong' }));
    svg.append(text(margin.left - 10, yAt(50) + 4, 'Even', { 'text-anchor': 'end' }));
    svg.append(text(margin.left - 10, yAt(0) + 4, 'AI', { 'text-anchor': 'end', class: 'tr-axis-strong' }));

    // X labels: thin them out when periods get narrow; mark each new year.
    const labelEvery = Math.max(1, Math.ceil(34 / step));
    buckets.forEach((bucket, index) => {
      if (index % labelEvery !== 0 && !bucket.label.isYearStart) return;
      svg.append(text(xAt(index), plotBottom + 16, bucket.label.short, { 'text-anchor': 'middle' }));
      if (index === 0 || bucket.label.isYearStart) {
        svg.append(text(xAt(index), plotBottom + 29, String(bucket.label.year), { 'text-anchor': 'middle', class: 'tr-axis-strong' }));
      }
    });

    // Lines break where a period has too few chats instead of bridging the gap.
    for (const series of visible) {
      let segment = [];
      const flush = () => {
        if (segment.length > 1) {
          svg.append(el('path', {
            d: segment.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(''),
            fill: 'none', stroke: series.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round'
          }));
        }
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
        svg.append(el('circle', {
          cx: xAt(index), cy: yAt(point.value), r: 4,
          fill: series.color, stroke: 'var(--tr-surface)', 'stroke-width': 2
        }));
      });
    }

    // Direct labels at each line's last point, nudged apart so they never overlap.
    if (!compact) {
      const labels = visible.map((series) => {
        const lastIndex = findLastIndex(buckets, (bucket) => bucket.points[series.key].ok);
        return lastIndex < 0 ? null : { series, y: yAt(buckets[lastIndex].points[series.key].value) };
      }).filter(Boolean).sort((a, b) => a.y - b.y);
      spreadLabels(labels, 15, margin.top, plotBottom);
      const labelX = margin.left + plotWidth + 12;
      for (const label of labels) {
        svg.append(el('line', { x1: labelX, x2: labelX + 12, y1: label.y, y2: label.y, stroke: label.series.color, 'stroke-width': 3, 'stroke-linecap': 'round' }));
        svg.append(text(labelX + 18, label.y + 4, label.series.short, { class: 'tr-label' }));
      }
    }

    // Chats per period: a separate small chart with its own scale (not a second y-axis).
    const maxChats = Math.max(1, ...buckets.map((bucket) => bucket.rows.length));
    svg.append(text(margin.left - 10, stripTop + 10, 'Chats', { 'text-anchor': 'end' }));
    svg.append(el('line', { x1: margin.left, x2: margin.left + plotWidth, y1: stripTop + stripHeight, y2: stripTop + stripHeight, stroke: 'var(--tr-axis)', 'stroke-width': 1 }));
    const barWidth = Math.max(2, Math.min(28, step - 4));
    const bars = buckets.map((bucket, index) => {
      const barHeight = bucket.rows.length ? Math.max(2, (bucket.rows.length / maxChats) * stripHeight) : 0;
      const bar = el('path', { d: roundedTopBar(xAt(index) - barWidth / 2, stripTop + stripHeight - barHeight, barWidth, barHeight, 3), fill: 'var(--tr-bar)' });
      svg.append(bar);
      if (bucket.rows.length) {
        svg.append(text(xAt(index), stripTop + stripHeight - barHeight - 4, String(bucket.rows.length), { 'text-anchor': 'middle', 'font-size': 10 }));
      }
      return bar;
    });

    // Hover: a crosshair snaps to the nearest period; the tooltip lists every line.
    const crosshair = el('line', { y1: margin.top, y2: stripTop + stripHeight, stroke: 'var(--tr-axis)', 'stroke-width': 1, visibility: 'hidden' });
    svg.append(crosshair);
    const hit = el('rect', { x: margin.left, y: margin.top, width: plotWidth, height: stripTop + stripHeight - margin.top, fill: 'transparent' });
    svg.append(hit);
    chartEl.append(svg);

    const tooltip = document.createElement('div');
    tooltip.className = 'tr-tooltip';
    tooltip.hidden = true;
    chartEl.append(tooltip);

    let activeBar = null;
    hit.addEventListener('pointermove', (event) => {
      const box = svg.getBoundingClientRect();
      const scale = width / box.width;
      const x = (event.clientX - box.left) * scale;
      const index = Math.min(buckets.length - 1, Math.max(0, Math.floor((x - margin.left) / step)));
      const bucket = buckets[index];
      crosshair.setAttribute('x1', xAt(index));
      crosshair.setAttribute('x2', xAt(index));
      crosshair.setAttribute('visibility', 'visible');
      if (activeBar) activeBar.setAttribute('fill', 'var(--tr-bar)');
      activeBar = bars[index];
      activeBar.setAttribute('fill', 'var(--tr-bar-hover)');

      tooltip.innerHTML = `
        <div class="tr-tooltip-title">${esc(bucket.label.long)}</div>
        <div class="tr-tooltip-sub">${bucket.rows.length} chat${bucket.rows.length === 1 ? '' : 's'}</div>
        ${visible.map((series) => {
          const point = bucket.points[series.key];
          const value = point.ok ? `${Math.round(point.value)}` : point.n ? 'too few' : '–';
          return `<div class="tr-tooltip-row${point.ok ? '' : ' tr-muted'}">
            <span class="tr-key" style="background:${series.color}"></span>
            <span>${esc(series.short)} <span style="color:var(--ink-3)">(${point.n})</span></span>
            <span class="tr-val">${value}</span>
          </div>`;
        }).join('')}`;
      tooltip.hidden = false;
      const chartBox = chartEl.getBoundingClientRect();
      const pointerX = event.clientX - chartBox.left;
      const left = pointerX + 16 + tooltip.offsetWidth > chartBox.width ? pointerX - 16 - tooltip.offsetWidth : pointerX + 16;
      tooltip.style.left = `${Math.max(0, left)}px`;
      tooltip.style.top = `${Math.max(0, event.clientY - chartBox.top - 40)}px`;
    });
    hit.addEventListener('pointerleave', () => {
      crosshair.setAttribute('visibility', 'hidden');
      if (activeBar) activeBar.setAttribute('fill', 'var(--tr-bar)');
      tooltip.hidden = true;
    });
  }

  function renderTable() {
    const rows = filteredRows();
    if (!rows.length) {
      tableEl.innerHTML = '<div class="tr-empty">No chats match these filters.</div>';
      return;
    }
    const buckets = buildBuckets(rows);
    const visible = SERIES.filter((series) => !state.hidden.has(series.key));
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

  function spreadLabels(labels, gap, min, max) {
    for (let i = 1; i < labels.length; i += 1) {
      labels[i].y = Math.max(labels[i].y, labels[i - 1].y + gap);
    }
    const overflow = labels.length ? labels[labels.length - 1].y - max : 0;
    if (overflow > 0) {
      labels[labels.length - 1].y -= overflow;
      for (let i = labels.length - 2; i >= 0; i -= 1) {
        labels[i].y = Math.min(labels[i].y, labels[i + 1].y - gap);
      }
    }
    for (const label of labels) label.y = Math.max(min, label.y);
  }

  function roundedTopBar(x, y, width, height, radius) {
    if (height <= 0) return '';
    const r = Math.min(radius, height, width / 2);
    return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
  }

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
