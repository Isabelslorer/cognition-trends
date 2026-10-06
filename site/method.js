// "How it's scored" view: walks through the method with a made-up example conversation (steps 1-2),
// then shows how the reader's own chats are combined into a slider (step 3) and a trend line (step 4).
// Steps 3-4 compute from D.timeline in the browser with the same rules as pipeline/build-dashboard.mjs
// and trends.js, so the numbers match the other views.
(() => {
  const DATA = window.MIRO_DASHBOARD_DATA;
  const root = document.getElementById('mdContent');
  if (!DATA || !root) return;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MIN_CHATS = 5; // same as trends.js
  const MIN_MOMENTS = DATA.reliability?.min_moments || 2; // same as MIN_MOMENTS in lib/common.mjs
  const WEIGHTS = { major: 2, minor: 1 };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DIMS = (DATA.dimensions || []).map((dimension, index) => ({ ...dimension, color: `var(--tr-series-${index + 1})` }));
  const dimOf = Object.fromEntries(DIMS.map((dimension) => [dimension.key, dimension]));
  const MOMENT_DIMS = ['ideas', 'direction', 'research', 'building', 'problems', 'final_call'];

  const REACTIONS = {
    accept: { label: 'took it as is', side: 'ai' }, question: { label: 'questioned it', side: 'user' },
    correct: { label: 'corrected it', side: 'user' }, test: { label: 'tested it', side: 'user' },
    edit: { label: 'edited it', side: 'user' }, build_on: { label: 'built on it', side: null },
    redirect: { label: 'changed course', side: null }, none: { label: 'first message', side: null }
  };
  const REQUESTS = {
    do_it: { label: 'asks for the answer', side: 'ai' }, options: { label: 'asks for options', side: 'ai' },
    explain: { label: 'asks to understand', side: 'user' }, critique_mine: { label: 'asks for critique of own work', side: 'user' },
    inform: { label: 'gives information', side: null }, none: { label: 'no request', side: null }
  };

  // Fictional example, coded the way the analysis codes real chats (see docs/codebook.md).
  const EXAMPLE = [
    { role: 'user', text: 'Write a Python function that returns the median of a list of numbers.', reaction: 'none', request: 'do_it',
      moments: [['direction', 'user', 'minor', 'Sets the goal: a median function']] },
    { role: 'ai', text: 'Here\'s a version that sorts the list and returns the middle value, or the average of the two middle values. (code)',
      moments: [['building', 'ai', 'major', 'Writes the first version'], ['ideas', 'ai', 'minor', 'Picks the sort-then-take-the-middle approach']] },
    { role: 'user', text: 'I ran it on an empty list and got IndexError. It should return None for empty input.', reaction: 'test', request: 'do_it',
      moments: [['problems', 'user', 'major', 'Finds the empty-list crash by running it'], ['ideas', 'user', 'minor', 'Decides empty input should return None']] },
    { role: 'ai', text: 'Good catch. Added a check that returns None for an empty list. (code)',
      moments: [['building', 'ai', 'major', 'Writes the fix']] },
    { role: 'user', text: 'Ran my tests again. With strings like (\'3\', \'10\') it sorts them as text and gives the wrong median. It should raise a TypeError.', reaction: 'test', request: 'do_it',
      moments: [['problems', 'user', 'major', 'Finds the string-sorting bug with tests']] },
    { role: 'ai', text: 'You\'re right, \'10\' sorts before \'3\' as text. Added a type check that raises TypeError. (code)',
      moments: [['building', 'ai', 'major', 'Writes the type check']] },
    { role: 'user', text: 'All 12 tests pass now.', reaction: 'test', request: 'none', moments: [] },
    { role: 'ai', text: 'Great, glad everything passes.', moments: [] }
  ];

  const state = { dim: 'checking', rendered: false };

  window.addEventListener('miro:route', (event) => { if (event.detail === 'how') render(); });
  window.addEventListener('miro:source', () => { if (state.rendered && !document.getElementById('how').hidden) renderLive(); });

  function render() {
    if (!state.rendered) {
      root.innerHTML = `
        ${stepHead(1, 'Code the conversation', 'A model (Claude) reads the whole chat and records <strong>moments</strong>: who came up with an idea, steered, brought information, built something, spotted a problem or settled a decision, at which message. It also gives every one of your messages two codes: how you reacted to the AI\'s previous answer, and what you asked for. It does not give scores.')}
        <div class="card md-card">
          <div class="md-example-head">
            <div class="md-example-title">Example: fixing a median function</div>
            <div class="md-example-note">A made-up chat, coded the way your chats are coded.</div>
          </div>
          <div class="md-legend">${MOMENT_DIMS.map((key) => `<span><i style="background:${dimOf[key]?.color}"></i>${esc(dimOf[key]?.label || key)}</span>`).join('')}</div>
          <ol class="md-chat">${EXAMPLE.map(renderMessage).join('')}</ol>
        </div>

        ${stepHead(2, 'Count the moments into a position', `Each moment adds weight to your side or AI's side: <strong>major counts 2, minor counts 1</strong>. Your two message codes are counted the same way, one per message. The position is <strong>100 × your weight ÷ (your weight + AI weight)</strong>, so 0 means AI did all of it and 100 means you did. A kind of work only counts in a chat if it came up at least ${MIN_MOMENTS} times; a single moment is too easy to read differently.`)}
        <div class="card md-card"><div class="md-count">${renderCounts()}</div></div>

        ${stepHead(3, 'Combine your chats into a slider', 'Each chat gives one position per kind of work. The slider\'s dot is the <strong>average</strong> over all chats where that work counted, and the shaded band covers the <strong>middle half</strong> of them (25th to 75th percentile). This uses your own chats and follows the source switch at the top.')}
        <div class="md-picker tr-chips" id="mdPicker" role="group" aria-label="Kind of work">${DIMS.map((dimension) => `<button type="button" class="tr-chip" data-key="${dimension.key}" aria-pressed="${dimension.key === state.dim}">${esc(dimension.label)}</button>`).join('')}</div>
        <div class="card md-card" id="mdSlider"></div>

        ${stepHead(4, 'Follow it over time', `For the Over time view, chats are grouped by the month they started. Each point is the average of that month's chats, drawn only when at least <strong>${MIN_CHATS} chats</strong> count; thinner months are left as gaps.`)}
        <div class="card md-card" id="mdTrend"></div>

        ${stepHead(5, 'How much to trust it', 'The coding was checked in two ways. Correctness: made-up conversations with known answers. Consistency: some of your real chats coded twice by the same model, and once each by two different models. Details are in eval/README.md in the repo.')}
        <div class="card md-card" id="mdTrust"></div>`;
      root.querySelector('#mdPicker').addEventListener('click', (event) => {
        const button = event.target.closest('button');
        if (!button) return;
        state.dim = button.dataset.key;
        root.querySelectorAll('#mdPicker button').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
        renderLive();
      });
      state.rendered = true;
    }
    renderLive();
  }

  function renderLive() {
    renderSlider();
    renderTrend();
    renderTrust();
  }

  // --- step 1 --------------------------------------------------------------

  function renderMessage(message, index) {
    const codes = message.role === 'user'
      ? `<div class="md-codes"><span class="md-code ${REACTIONS[message.reaction].side || 'none'}">Reaction: ${esc(REACTIONS[message.reaction].label)}</span><span class="md-code ${REQUESTS[message.request].side || 'none'}">Request: ${esc(REQUESTS[message.request].label)}</span></div>`
      : '';
    const moments = message.moments.map(([key, actor, weight, note]) => `
      <li class="md-moment"><i style="background:${dimOf[key]?.color}"></i><span><strong>${esc(dimOf[key]?.label || key)}</strong> · ${actor === 'user' ? 'You' : 'AI'} · ${weight}</span><span class="md-note">${esc(note)}</span></li>`).join('');
    return `
      <li class="md-msg ${message.role}">
        <div class="md-num">${index + 1}</div>
        <div class="md-body">
          <div class="md-who">${message.role === 'user' ? 'You' : 'AI'}</div>
          <div class="md-text">${esc(message.text)}</div>
          ${codes}
          ${moments ? `<ul class="md-moments">${moments}</ul>` : ''}
        </div>
      </li>`;
  }

  // --- step 2 --------------------------------------------------------------

  function exampleItems(key) {
    if (key === 'checking' || key === 'understanding') {
      const table = key === 'checking' ? REACTIONS : REQUESTS;
      const field = key === 'checking' ? 'reaction' : 'request';
      return EXAMPLE.map((message, index) => ({ message, index }))
        .filter(({ message }) => message.role === 'user' && table[message[field]].side)
        .map(({ message, index }) => ({ actor: table[message[field]].side, weight: 1, turn: index + 1, label: table[message[field]].label }));
    }
    return EXAMPLE.flatMap((message, index) => message.moments
      .filter(([dimension]) => dimension === key)
      .map(([, actor, weight]) => ({ actor, weight: WEIGHTS[weight], turn: index + 1, label: weight })));
  }

  function renderCounts() {
    return DIMS.map((dimension) => {
      const items = exampleItems(dimension.key);
      const you = items.filter((item) => item.actor === 'user').reduce((sum, item) => sum + item.weight, 0);
      const ai = items.filter((item) => item.actor === 'ai').reduce((sum, item) => sum + item.weight, 0);
      const counted = items.length >= MIN_MOMENTS;
      const position = you + ai ? Math.round((100 * you) / (you + ai)) : null;
      const squares = [
        ...items.filter((item) => item.actor === 'ai').flatMap((item) => Array(item.weight).fill(`<b class="sq ai" title="AI, message ${item.turn}"></b>`)),
        ...items.filter((item) => item.actor === 'user').flatMap((item) => Array(item.weight).fill(`<b class="sq you" title="You, message ${item.turn}"></b>`))
      ].join('');
      const result = !items.length
        ? '<span class="md-muted">Didn\'t come up in this chat</span>'
        : !counted
          ? `<span class="md-muted">Came up only ${items.length === 1 ? 'once' : `${items.length} times`}, so not counted (needs ${MIN_MOMENTS}+)</span>`
          : `<span class="md-formula">100 × ${you} ÷ (${you} + ${ai}) = <strong>${position}</strong></span>`;
      return `
        <div class="md-row ${counted ? '' : 'off'}">
          <div class="md-row-label"><i style="background:${dimension.color}"></i>${esc(dimension.label)}</div>
          <div class="md-squares">${squares || '<span class="md-muted">–</span>'}</div>
          <div class="md-row-result">${result}</div>
          <div class="md-mini">${counted ? miniScale(position) : ''}</div>
        </div>`;
    }).join('') + `<div class="md-key"><span><b class="sq ai"></b> AI weight</span><span><b class="sq you"></b> your weight</span><span>Your message codes count 1 each: tested, questioned, corrected or edited count for you; took it as is counts for AI. Asked to understand or for critique counts for you; asked for the answer counts for AI.</span></div>`;
  }

  function miniScale(position) {
    return `<div class="md-scale"><span class="md-scale-ai">AI</span><div class="md-track"><div class="md-dot" style="left:${position}%"></div></div><span class="md-scale-you">You</span></div>`;
  }

  // --- data shared by steps 3-4 ---------------------------------------------

  function sourceKey() {
    return window.MIRO_SOURCE || 'all';
  }

  function rowsForSource() {
    const source = sourceKey();
    return (DATA.timeline || []).filter((row) => source === 'all' || (row.source || 'claude_ai') === source);
  }

  function valuesFor(key) {
    return rowsForSource().map((row) => row.split?.[key]).filter(Number.isFinite);
  }

  // --- step 3 --------------------------------------------------------------

  function renderSlider() {
    const el = document.getElementById('mdSlider');
    const dimension = dimOf[state.dim];
    const values = valuesFor(state.dim);
    if (!values.length) {
      el.innerHTML = `<div class="md-muted">No chats from this source where "${esc(dimension.label)}" came up ${MIN_MOMENTS}+ times.</div>`;
      return;
    }
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const position = Math.round(mean);
    const lo = Math.round(Math.min(percentile(values, 0.25), position));
    const hi = Math.round(Math.max(percentile(values, 0.75), position));
    const verdict = verdictFor(position);
    const aspect = (DATA.variants?.[sourceKey()] || DATA).aspects?.find((item) => item.key === state.dim);

    // Histogram of per-chat positions in 10-point bins, with the slider drawn on the same axis below.
    const bins = Array(10).fill(0);
    for (const value of values) bins[Math.min(9, Math.floor(value / 10))] += 1;
    const width = 720;
    const height = 250;
    const margin = { left: 34, right: 34, top: 16 };
    const plot = width - margin.left - margin.right;
    const histHeight = 120;
    const x = (value) => margin.left + (value / 100) * plot;
    const max = Math.max(...bins);
    const svg = el2('svg', { viewBox: `0 0 ${width} ${height}`, class: 'md-svg', role: 'img', 'aria-label': `Distribution of ${values.length} chats for ${dimension.label}` });

    // Verdict zones behind the histogram.
    const zones = [[0, 20, 'Clearly AI'], [20, 42, 'Leaned to AI'], [42, 58, 'Shared'], [58, 80, 'Leaned to you'], [80, 100, 'Clearly you']];
    zones.forEach(([from, to, label], index) => {
      svg.append(el2('rect', { x: x(from), y: margin.top, width: x(to) - x(from), height: histHeight, fill: index % 2 ? 'rgba(52,44,37,0.035)' : 'rgba(52,44,37,0.0)' }));
      svg.append(text((x(from) + x(to)) / 2, margin.top + histHeight + 16, label, { class: 'md-zone', 'text-anchor': 'middle' }));
    });
    bins.forEach((count, index) => {
      const barHeight = max ? (count / max) * (histHeight - 14) : 0;
      const bx = x(index * 10) + 3;
      const bw = x(10) - x(0) - 6;
      svg.append(el2('rect', { x: bx, y: margin.top + histHeight - barHeight, width: bw, height: barHeight, rx: 3, fill: dimension.color, opacity: 0.35 }));
      if (count) svg.append(text(bx + bw / 2, margin.top + histHeight - barHeight - 4, String(count), { class: 'md-count-label', 'text-anchor': 'middle' }));
    });
    svg.append(el2('line', { x1: x(0), x2: x(100), y1: margin.top + histHeight, y2: margin.top + histHeight, stroke: 'var(--tr-axis)' }));

    // The slider itself.
    const trackY = margin.top + histHeight + 52;
    svg.append(el2('rect', { x: x(0), y: trackY - 7, width: plot / 2, height: 14, rx: 7, fill: 'rgba(74,178,212,0.4)' }));
    svg.append(el2('rect', { x: x(50), y: trackY - 7, width: plot / 2, height: 14, rx: 7, fill: 'rgba(201,161,100,0.4)' }));
    svg.append(el2('rect', { x: x(lo), y: trackY - 10, width: Math.max(2, x(hi) - x(lo)), height: 20, rx: 6, fill: 'rgba(28,25,23,0.10)' }));
    for (const tick of [lo, hi]) svg.append(el2('line', { x1: x(tick), x2: x(tick), y1: trackY - 12, y2: trackY + 12, stroke: 'rgba(28,25,23,0.35)', 'stroke-width': 2 }));
    svg.append(el2('circle', { cx: x(position), cy: trackY, r: 9, fill: '#1c1917' }));
    svg.append(text(x(0), trackY + 30, 'AI', { class: 'md-axis' }));
    svg.append(text(x(100), trackY + 30, 'You', { class: 'md-axis', 'text-anchor': 'end' }));
    svg.append(text(x(position), trackY - 16, `average ${position}`, { class: 'md-callout', 'text-anchor': 'middle' }));
    svg.append(text(x(lo), trackY + 30, String(lo), { class: 'md-axis', 'text-anchor': 'middle' }));
    svg.append(text(x(hi), trackY + 30, String(hi), { class: 'md-axis', 'text-anchor': 'middle' }));

    el.innerHTML = `<div class="md-chart-title">${esc(dimension.question || dimension.label)}</div>
      <div class="md-chart-sub">Bars: how many of your chats landed at each position. Below: the slider those chats make.</div>`;
    el.append(svg);
    el.insertAdjacentHTML('beforeend', `<ul class="md-facts">
      <li><strong>${values.length} chats</strong> counted. The average of their positions is <strong>${mean.toFixed(1)}</strong>, which rounds to ${position}: <strong>${verdict}</strong>.</li>
      <li>The middle half of chats fall between <strong>${lo}</strong> and <strong>${hi}</strong>. ${hi - lo >= 60 ? 'A band this wide means it varies a lot from chat to chat, so the average hides very different kinds of chats.' : hi - lo >= 30 ? 'That is a fair amount of spread: the average is typical, but plenty of chats sit well away from it.' : 'A narrow band means most chats look alike, so the average describes them well.'}</li>
      ${aspect?.footnote ? `<li class="md-muted">${esc(aspect.footnote)}</li>` : ''}
    </ul>`);
  }

  // --- step 4 --------------------------------------------------------------

  function renderTrend() {
    const el = document.getElementById('mdTrend');
    const dimension = dimOf[state.dim];
    const rows = rowsForSource().filter((row) => row.date && Number.isFinite(row.split?.[state.dim]));
    const allDates = (DATA.timeline || []).map((row) => row.date).filter(Boolean).sort();
    if (!rows.length || !allDates.length) {
      el.innerHTML = '<div class="md-muted">No chats to plot for this source.</div>';
      return;
    }
    const keyOf = (date) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
    const first = keyOf(allDates[0]);
    const last = keyOf(allDates[allDates.length - 1]);
    const months = Array.from({ length: last - first + 1 }, (_, index) => ({ key: first + index, values: [] }));
    for (const row of rows) months[keyOf(row.date) - first].values.push(row.split[state.dim]);
    for (const month of months) {
      month.n = month.values.length;
      month.mean = month.n ? month.values.reduce((sum, value) => sum + value, 0) / month.n : null;
      month.ok = month.n >= MIN_CHATS;
    }

    const width = 720;
    const height = 300;
    const margin = { left: 40, right: 16, top: 14, bottom: 58 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;
    const step = plotW / months.length;
    const xAt = (index) => margin.left + step * (index + 0.5);
    const yAt = (value) => margin.top + (1 - value / 100) * plotH;
    const svg = el2('svg', { viewBox: `0 0 ${width} ${height}`, class: 'md-svg', role: 'img', 'aria-label': `${dimension.label} by month` });

    for (const value of [0, 50, 100]) {
      svg.append(el2('line', { x1: margin.left, x2: width - margin.right, y1: yAt(value), y2: yAt(value), stroke: value === 50 ? 'var(--tr-axis)' : 'var(--tr-grid)' }));
      svg.append(text(margin.left - 6, yAt(value) + 4, value === 100 ? 'You' : value === 0 ? 'AI' : 'Even', { class: 'md-axis', 'text-anchor': 'end' }));
    }
    // Every chat as a faint dot, jittered within its month, so the averaging is visible.
    months.forEach((month, index) => {
      month.values.forEach((value, i) => {
        const jitter = ((i * 37) % 11) / 10 - 0.5;
        svg.append(el2('circle', { cx: xAt(index) + jitter * step * 0.6, cy: yAt(value), r: 2, fill: dimension.color, opacity: 0.18 }));
      });
    });
    // The trend line: only months with enough chats, broken across gaps.
    let segment = [];
    const flush = () => {
      if (segment.length > 1) svg.append(el2('polyline', { points: segment.join(' '), fill: 'none', stroke: dimension.color, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }));
      segment = [];
    };
    months.forEach((month, index) => {
      if (month.ok) segment.push(`${xAt(index)},${yAt(month.mean)}`);
      else flush();
    });
    flush();
    months.forEach((month, index) => {
      if (!month.n) return;
      svg.append(el2('circle', month.ok
        ? { cx: xAt(index), cy: yAt(month.mean), r: 5, fill: dimension.color, stroke: 'var(--tr-surface)', 'stroke-width': 2 }
        : { cx: xAt(index), cy: yAt(month.mean), r: 4, fill: 'var(--tr-surface)', stroke: 'rgba(52,44,37,0.35)', 'stroke-width': 1.5, 'stroke-dasharray': '2 2' }));
    });
    months.forEach((month, index) => {
      const date = month.key;
      if (index % Math.max(1, Math.ceil(months.length / 10)) === 0 || index === months.length - 1) {
        svg.append(text(xAt(index), height - margin.bottom + 18, MONTHS[date % 12], { class: 'md-axis', 'text-anchor': 'middle' }));
        if (date % 12 === 0 || index === 0) svg.append(text(xAt(index), height - margin.bottom + 32, String(Math.floor(date / 12)), { class: 'md-axis md-year', 'text-anchor': 'middle' }));
      }
      if (month.n) svg.append(text(xAt(index), height - 6, String(month.n), { class: 'md-count-label', 'text-anchor': 'middle' }));
    });
    svg.append(text(margin.left - 6, height - 6, 'chats', { class: 'md-count-label', 'text-anchor': 'end' }));

    const busiest = months.filter((month) => month.ok).sort((a, b) => b.n - a.n)[0];
    const thin = months.filter((month) => month.n && !month.ok).length;
    el.innerHTML = `<div class="md-chart-title">${esc(dimension.label)}, month by month</div>
      <div class="md-chart-sub">Faint dots: single chats. Filled points: monthly averages (${MIN_CHATS}+ chats). Dashed circles: months with too few chats, left off the line. Numbers below: chats per month.</div>`;
    el.append(svg);
    el.insertAdjacentHTML('beforeend', `<ul class="md-facts">
      ${busiest ? `<li>For example, <strong>${MONTHS[busiest.key % 12]} ${Math.floor(busiest.key / 12)}</strong>: the average of ${busiest.n} chats is <strong>${busiest.mean.toFixed(1)}</strong>, which becomes that month's point.</li>` : '<li>No month has enough chats for a point yet.</li>'}
      ${thin ? `<li>${thin} month${thin === 1 ? ' has' : 's have'} fewer than ${MIN_CHATS} chats, so ${thin === 1 ? 'it is' : 'they are'} left as a gap rather than drawn from too little data. Grouping by quarter in the Over time view fills many gaps.</li>` : ''}
      <li>A line moving up means you carried more of this kind of work in later months; down means AI did. Topic and other filters in the Over time view just change which chats go into each month.</li>
    </ul>`);
  }

  // --- step 5 --------------------------------------------------------------

  function renderTrust() {
    const el = document.getElementById('mdTrust');
    const reliability = DATA.reliability;
    if (!reliability) {
      el.innerHTML = '<div class="md-muted">No reliability check has been run for this data yet (npm run eval -- --real).</div>';
      return;
    }
    const word = (alpha) => (alpha >= 0.8 ? 'high' : alpha >= 0.667 ? 'moderate' : 'low');
    const cell = (measured) => (measured ? `<span class="md-rel ${word(measured.alpha)}">${word(measured.alpha)}</span> <span class="md-muted">α ${measured.alpha.toFixed(2)}, ${measured.chats} chats</span>` : '<span class="md-muted">too few test chats</span>');
    el.innerHTML = `
      <div class="md-chart-sub">Agreement is Krippendorff's α: 1 is perfect, 0 is chance, 0.8+ is the usual bar for reliable data. Tested on ${reliability.sample} of your chats, so each figure is rough.</div>
      <table class="md-table">
        <thead><tr><th>Kind of work</th><th>Same model, run twice</th><th>Two different models</th></tr></thead>
        <tbody>${DIMS.map((dimension) => {
          const measured = reliability.dimensions?.[dimension.key];
          return `<tr><td><i style="background:${dimension.color}"></i>${esc(dimension.label)}</td><td>${cell(measured?.repeat)}</td><td>${cell(measured?.cross)}</td></tr>`;
        }).join('')}</tbody>
      </table>
      <ul class="md-facts">
        <li>"Run twice" asks whether the model reads the same chat the same way again. High means a change over time is not just the model reading a chat differently on another day.</li>
        <li>"Two models" asks whether a different model reads it the same way. Low means this kind of work is open to interpretation, so treat it as an indication, not a measurement.</li>
        <li>The known-answer test set was written by Claude, not labelled by people, so it checks that the rules are applied as written, not that they match how a human would read your chats.</li>
      </ul>`;
  }

  // --- helpers -------------------------------------------------------------

  function stepHead(number, title, body) {
    return `<div class="md-step"><div class="md-step-num">${number}</div><div><div class="md-step-title">${esc(title)}</div><div class="md-step-body">${body}</div></div></div>`;
  }

  function percentile(values, fraction) {
    const sorted = [...values].sort((a, b) => a - b);
    const position = (sorted.length - 1) * fraction;
    const lower = Math.floor(position);
    return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
  }

  // Same thresholds as verdictFor() in pipeline/build-dashboard.mjs.
  function verdictFor(position) {
    if (position >= 80) return 'Clearly you';
    if (position >= 58) return 'Leaned to you';
    if (position > 42) return 'Shared';
    if (position > 20) return 'Leaned to AI';
    return 'Clearly AI';
  }

  function el2(name, attrs) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  }

  function text(x, y, content, attrs = {}) {
    const node = el2('text', { x, y, ...attrs });
    node.textContent = content;
    return node;
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (match) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[match]));
  }
})();
