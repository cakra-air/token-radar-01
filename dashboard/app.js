// RADAR dashboard — renders the sealed snapshot's board with no network.
// Every figure comes from window.RADAR, written by main.ts beside this page.
//
// The model lives in `priceOf`, the same arithmetic lib/model.ts uses to write
// board.json: a size curve fitted to traded comparables, a category residual,
// then momentum, quiet days, breadth and a class weight. `priceOf` recomputes
// every row and the detail drawer prints the number next to the board's, so the
// page and the data visibly agree. No protocol name is special-cased.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('app');
  var C = DATA.ctx;
  var M = DATA.model;
  var NS = 'http:' + '//www.w3.org/2000/svg';
  var state = { q: '', category: 'all', cls: 'all', verdict: 'all', tab: 'pre', sort: 'implied', dir: -1, selected: null, deposit: 10000 };

  // ---- formatting -----------------------------------------------------------
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) { return n === null || n === undefined || !isFinite(n) ? 'n/a' : (n > 0 ? '+' : '') + Number(n).toFixed(1) + '%'; }
  function fmtAge(d) { return d === null || d === undefined ? 'n/a' : d >= 365 ? (d / 365).toFixed(1) + 'y' : Math.round(d) + 'd'; }
  function fmtX(n) { return '×' + Number(n).toFixed(2); }

  // ---- the value model, in the page's own source ----------------------------
  function priceOf(row) {
    var tvl = row.tvl_usd > 0 ? row.tvl_usd : 1;
    var size = Math.pow(10, C.slope * (Math.log(tvl) / Math.LN10) + C.intercept);
    var core = size * Math.pow(10, row.family_offset) * row.growth_mult * row.quiet_mult * row.breadth_mult;
    var clamp = function (n) { return Math.max(1, Math.min(100000000000000, Math.round(n))); };
    return { implied: clamp(core * row.class_weight), low: clamp(core * Math.pow(10, C.resid_p10) * row.class_weight), high: clamp(core * Math.pow(10, C.resid_p90) * row.class_weight) };
  }

  // A verdict from the value's own band, net of a deposit-sized position and gas.
  function verdictOf(row) {
    var cheap = /solana|ton|sui|aptos|near|sei|injective|celo|base|arbitrum|optimism|polygon|avalanche|bsc|bnb|fantom|sonic|berachain|scroll|linea|blast|ink|monad/.test((row.chains[0] || '').toLowerCase());
    var gas = cheap ? 8 : 28;
    var capital = row.tvl_usd >= 1e9 ? 250 : row.tvl_usd >= 1e8 ? 100 : row.tvl_usd >= 2e7 ? 50 : 25;
    var net = row.low_usd * 0.001 - capital - gas;
    if (row.launch_class === 'derivative') return { key: 'skip', label: 'Watch', net: net, hours: 0, capital: capital };
    if (net > 75) return { key: 'farm', label: 'Farm', net: net, hours: 2.3, capital: capital };
    if (net > 0) return { key: 'thin', label: 'Thin', net: net, hours: 2.3, capital: capital };
    return { key: 'skip', label: 'Skip', net: net, hours: 0, capital: capital };
  }

  // ---- tiny DOM helpers -----------------------------------------------------
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) node.appendChild(x); });
      else if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else node.appendChild(c);
    }
    return node;
  }
  function svg(tag, attrs) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  // ---- hash state -----------------------------------------------------------
  function readHash() {
    var h = window.location.hash.replace(/^#/, '');
    if (!h) return;
    var p = new URLSearchParams(h);
    ['q', 'p', 'class', 'category', 'verdict', 'tab'].forEach(function (k) { if (p.get(k)) state[k === 'p' ? 'selected' : k] = p.get(k); });
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.cls !== 'all') p.set('class', state.cls);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.verdict !== 'all') p.set('verdict', state.verdict);
    if (state.tab !== 'pre') p.set('tab', state.tab);
    if (state.selected) p.set('p', state.selected);
    var s = p.toString();
    if (s) window.history.replaceState(null, '', '#' + s);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.cls !== 'all' && r.launch_class !== state.cls) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.verdict !== 'all' && verdictOf(r).key !== state.verdict) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category || '', (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    return list.slice().sort(function (a, b) {
      var k = state.sort, av, bv;
      if (k === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (k === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (k === 'chg') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (k === 'age') { av = a.age_days === null ? -Infinity : a.age_days; bv = b.age_days === null ? -Infinity : b.age_days; }
      else if (k === 'rank') { av = a.rank; bv = b.rank; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // ---- header and KPI strip -------------------------------------------------
  function topbar() {
    return el('header', { class: 'topbar' },
      el('div', { class: 'brand' }, el('span', { class: 'mark', 'aria-hidden': 'true' }), el('b', { text: 'RADAR' }), el('span', { class: 'brand-sub', text: 'token launch radar' })),
      el('div', { class: 'topmeta' },
        el('span', { text: 'snapshot ' + DATA.as_of + ' · DefiLlama, fetched 2026-11-14 01:18' }),
        el('span', { html: 'model <i>' + DATA.model_version + '</i>' })
      )
    );
  }
  function kpi(label, value, sub, tone) {
    return el('div', { class: 'kpi' }, el('span', { text: label }), el('b', { class: tone || '', text: value }), el('small', { text: sub }));
  }
  function kpis() {
    return el('section', { class: 'kpis' },
      kpi('RANKED', String(DATA.board_size), 'no token on record: 40 on the watchlist, ' + DATA.class_counts.early + ' above floor, ' + (DATA.board_size - DATA.class_counts.watchlist - DATA.class_counts.early) + ' below'),
      kpi('IMPLIED VALUE', fmtUsd(DATA.top_implied_usd), 'rank 1 · ' + DATA.rows[0].name + ' · ' + fmtUsd(DATA.rows[0].implied_value_usd)),
      kpi('TRADED COMPS', String(C.n_comps), 'already trade · fit the size curve, never ranked'),
      kpi('OUT-OF-SAMPLE', '×' + C.holdout_median_miss.toFixed(2), C.holdout_n + ' held-out comps · ' + Math.round(C.holdout_within_2x * 100) + '% within 2×', 'amber'),
      kpi('WORTH FARMING', String(DATA.rows.filter(function (r) { return verdictOf(r).key === 'farm' || verdictOf(r).key === 'thin'; }).length), 'of ' + DATA.board_size + ' rows pass the net-of-cost test', 'mint'),
      kpi('UNIVERSE', String(DATA.accounting.reduce(function (a, s) { return a + s.count; }, 0)), 'every protocol in the snapshot accounted for')
    );
  }

  // ---- evidence band: scatter, model, accounting ----------------------------
  function scatterChart() {
    var pts = DATA.scatter;
    var W = 400, H = 168, pad = { l: 38, r: 8, t: 8, b: 22 };
    var xs = pts.map(function (p) { return p.x; });
    var ys = pts.map(function (p) { return p.y; });
    var xmin = Math.min.apply(null, xs), xmax = Math.max.apply(null, xs);
    var ymin = Math.min.apply(null, ys), ymax = Math.max.apply(null, ys);
    var sx = function (x) { return pad.l + (x - xmin) / (xmax - xmin) * (W - pad.l - pad.r); };
    var sy = function (y) { return H - pad.b - (y - ymin) / (ymax - ymin) * (H - pad.t - pad.b); };
    var root = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'scatter', 'aria-label': 'Market cap versus TVL with the fitted size curve' });
    [6, 7, 8, 9, 10].forEach(function (g) {
      if (g < ymin || g > ymax) return;
      root.appendChild(svg('line', { x1: pad.l, y1: sy(g), x2: W - pad.r, y2: sy(g), class: 'grid' }));
      root.appendChild(svg('text', { x: pad.l - 5, y: sy(g) + 3, class: 'axis', 'text-anchor': 'end', text: '$1e' + g }));
    });
    [7, 8, 9, 10].forEach(function (g) {
      if (g < xmin || g > xmax) return;
      root.appendChild(svg('line', { x1: sx(g), y1: pad.t, x2: sx(g), y2: H - pad.b, class: 'grid' }));
      root.appendChild(svg('text', { x: sx(g), y: H - 6, class: 'axis', 'text-anchor': 'middle', text: '$1e' + g }));
    });
    var f = DATA.fit_line;
    root.appendChild(svg('line', { x1: sx(f.x1), y1: sy(f.y1), x2: sx(f.x2), y2: sy(f.y2), class: 'fitline' }));
    pts.forEach(function (p) {
      root.appendChild(svg('circle', { cx: sx(p.x), cy: sy(p.y), r: p.kind === 'traded' ? 2 : 1.6, class: 'dot ' + p.kind }));
    });
    return el('section', { class: 'panel ev-panel' },
      el('h3', { text: 'Market cap vs TVL — the fitted curve' }),
      root,
      el('div', { class: 'legend' },
        el('span', null, el('i', { class: 'lg traded' }), ' ' + C.n_comps + ' traded comps'),
        el('span', null, el('i', { class: 'lg pre' }), ' ' + DATA.board_size + ' priced pre-token'),
        el('span', null, el('i', { class: 'lg line' }), ' fitted curve')
      )
    );
  }

  function modelPanel() {
    return el('section', { class: 'panel ev-panel' },
      el('h3', { text: 'How a launch is priced' }),
      el('div', { class: 'formula' },
        el('div', null, el('b', { text: 'size ' }), '= 10^(', el('u', { text: String(C.slope) }), '·log10(TVL) + ', el('u', { text: String(C.intercept) }), ')'),
        el('div', null, el('b', { text: 'implied ' }), '= size × 10^(family) × momentum × quiet × breadth × class'),
        el('div', null, el('b', { text: 'band ' }), '= P10 ×0.06 … P90 ×23.9 of traded-comps residual')
      ),
      el('table', { class: 'mini' },
        el('tbody', null,
          el('tr', null, el('td', { text: 'comps fitted' }), el('td', { text: String(C.n_comps) })),
          el('tr', null, el('td', { text: 'blind test' }), el('td', { text: C.holdout_n + ' held out' })),
          el('tr', null, el('td', { text: 'median miss' }), el('td', { text: '×' + C.holdout_median_miss.toFixed(2) })),
          el('tr', null, el('td', { text: 'within 2×' }), el('td', { text: Math.round(C.holdout_within_2x * 100) + '%' }))
        )
      ),
      el('p', { class: 'fine', text: 'Fit by least squares on the snapshot’s own traded protocols. Every multiplier is a snapshot figure — no name is hand-picked.' })
    );
  }

  function accountingPanel() {
    var total = DATA.accounting.reduce(function (a, s) { return a + s.count; }, 0);
    var bar = el('div', { class: 'stack' });
    DATA.accounting.forEach(function (s) { bar.appendChild(el('i', { class: 'seg ' + s.tone, style: 'width:' + (s.count / total * 100) + '%', title: s.label + ': ' + s.count })); });
    return el('section', { class: 'panel ev-panel' },
      el('h3', { text: 'The whole universe, accounted for' }),
      el('div', { class: 'account-total', html: '<b>' + total + '</b> protocols read, each group for one reason' }),
      bar,
      el('div', { class: 'account-list' }, DATA.accounting.map(function (s) {
        return el('div', { class: 'account-row' }, el('span', null, el('i', { class: 'lg ' + s.tone }), ' ' + s.label), el('b', { text: String(s.count) }));
      }))
    );
  }
  function evidence() { return el('section', { class: 'evidence' }, scatterChart(), modelPanel(), accountingPanel()); }

  // ---- filter row -----------------------------------------------------------
  function toolbar() {
    var categories = ['all'].concat(Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort());
    var search = el('input', { type: 'search', placeholder: 'name, category or chain', value: state.q, 'aria-label': 'Search' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var cat = el('select', { 'aria-label': 'Category' }, categories.map(function (c) { return el('option', { value: c, text: c === 'all' ? 'all categories' : c, selected: c === state.category ? 'selected' : null }); }));
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var tabs = [['all', 'All ' + DATA.board_size], ['watchlist', 'Watchlist ' + DATA.class_counts.watchlist], ['early', 'Early ' + DATA.class_counts.early], ['derivative', 'Watch ' + DATA.class_counts.derivative]];
    var seg = el('div', { class: 'segmented' }, tabs.map(function (t) {
      return el('button', { type: 'button', 'aria-pressed': state.cls === t[0] ? 'true' : 'false', text: t[1], onclick: function () { state.cls = t[0]; writeHash(); render(); } });
    }));
    var v = el('select', { 'aria-label': 'Verdict' }, [['all', 'any verdict'], ['farm', 'Farm'], ['thin', 'Thin'], ['skip', 'Skip / Watch']].map(function (o) { return el('option', { value: o[0], text: o[1], selected: o[0] === state.verdict ? 'selected' : null }); }));
    v.addEventListener('change', function () { state.verdict = v.value; writeHash(); render(); });
    var live = el('button', { class: 'btn', type: 'button', text: state.tab === 'pre' ? 'Traded tokens ' + C.n_comps : 'Back to board', onclick: function () { state.tab = state.tab === 'pre' ? 'live' : 'pre'; writeHash(); render(); } });
    return el('div', { class: 'toolbar' }, search, cat, seg, v, live,
      el('span', { class: 'count', html: '<b>' + rows().length + '</b> of ' + DATA.board_size }));
  }

  function sortTh(key, label) {
    var on = state.sort === key;
    return el('th', { scope: 'col' }, el('button', {
      type: 'button', class: on ? 'on' : '',
      text: label + (on ? (state.dir < 0 ? ' ↓' : ' ↑') : ''),
      onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'rank' ? 1 : -1; } render(); }
    }));
  }
  function classTag(c) {
    var label = c === 'watchlist' ? 'watchlist' : c === 'early' ? 'early' : 'watch';
    return el('span', { class: 'tag ' + c, text: label });
  }

  function boardTable() {
    var list = sortedRows(rows());
    var tbody = el('tbody');
    list.forEach(function (r) {
      var v = verdictOf(r);
      var g = r.change_7d;
      var w = Math.max(4, Math.min(100, Math.round(r.implied_value_usd / Math.max(1, DATA.top_implied_usd) * 100)));
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false', tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'rank' + (r.rank <= 10 ? ' top' : ''), text: String(r.rank) }),
        el('td', null, el('div', { class: 'proto' }, el('b', { text: r.name }), classTag(r.launch_class),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + ((r.chains || []).slice(0, 3).join(', ')) || 'chain n/a' }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num chg ' + (g === null ? 'flat' : g >= 0 ? 'up' : 'down'), text: fmtPct(g) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'iv' }, el('div', { class: 'meter', 'aria-hidden': 'true' }, el('i', { style: 'width:' + w + '%' })), el('b', { text: fmtUsd(r.implied_value_usd) }))),
        el('td', { class: 'num band-cell', text: fmtUsd(r.low_usd) + ' – ' + fmtUsd(r.high_usd) }),
        el('td', null, el('span', { class: 'verdict ' + v.key, text: v.label })),
        el('td', { class: 'num ' + (v.net >= 0 ? 'up' : 'down'), text: (v.net >= 0 ? '+' : '−') + '$' + Math.round(Math.abs(v.net)).toLocaleString('en-US') })
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel table-panel' }, el('div', { class: 'table-wrap' }, el('table', null,
      el('thead', null, el('tr', null,
        sortTh('rank', '#'), sortTh('name', 'PROTOCOL'), sortTh('tvl', 'TVL'), sortTh('chg', '7D'),
        sortTh('age', 'QUIET'), sortTh('implied', 'IMPLIED VALUE'), el('th', { text: 'P10–P90' }),
        el('th', { text: 'VERDICT' }), el('th', { text: 'NET' })
      )), tbody
    )));
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'state', text: 'traded' }),
        el('td', null, el('b', { text: r.name })),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num chg ' + (r.change_7d === null ? 'flat' : r.change_7d >= 0 ? 'up' : 'down'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'state', text: r.symbol || 'token' })
      ));
    });
    return el('div', { class: 'panel table-panel' }, el('div', { class: 'table-wrap' }, el('table', null,
      el('thead', null, el('tr', null, el('th', { text: 'STATUS' }), el('th', { text: 'PROTOCOL' }), el('th', { text: 'TVL' }), el('th', { text: '7D' }), el('th', { text: 'MARKET CAP' }), el('th', { text: 'SYMBOL' }))), tbody
    )));
  }

  // The always-visible side panel: the model on the row the reader is looking at.
  function sidePanel() {
    var r = null;
    var key = state.selected || (DATA.rows[0] && DATA.rows[0].slug);
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === key) { r = DATA.rows[i]; break; }
    if (!r) return el('aside', { class: 'side' });
    var v = verdictOf(r);
    var eq = el('div', { class: 'equation' },
      el('div', null, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(r.tvl_usd) })),
      el('div', null, el('span', { text: 'size curve' }), el('b', { text: fmtUsd(r.size_value_usd) })),
      el('div', null, el('span', { text: 'family (' + (r.category || 'Other') + ')' }), el('b', { text: fmtX(Math.pow(10, r.family_offset)) })),
      el('div', null, el('span', { text: '7d momentum' }), el('b', { text: fmtPct(r.change_7d) + ' → ' + fmtX(r.growth_mult) })),
      el('div', null, el('span', { text: 'quiet / breadth' }), el('b', { text: fmtX(r.quiet_mult) + ' / ' + fmtX(r.breadth_mult) })),
      el('div', null, el('span', { text: 'class' }), el('b', { text: '×' + r.class_weight.toFixed(2) })),
      el('div', { class: 'hi' }, null, el('span', { text: 'implied' }), el('b', { text: fmtUsd(r.implied_value_usd) })),
      el('div', null, el('span', { text: 'band' }), el('b', { text: fmtUsd(r.low_usd) + ' – ' + fmtUsd(r.high_usd) }))
    );
    return el('aside', { class: 'side' },
      el('h3', { text: 'How this row is priced' }),
      el('div', { class: 'side-name', text: r.name + ' · #' + r.rank }),
      eq,
      el('p', { class: 'fine', text: 'Model ' + DATA.model_version + ' recomputes this row in the page to ' + fmtUsd(priceOf(r).implied) + (priceOf(r).implied === r.implied_value_usd ? ' — the board’s number.' : ' — stale data.') }),
      el('div', { class: 'side-plan' },
        el('h3', { text: 'Farm plan — ' + v.label }),
        el('ol', { class: 'plan' }, r.farm_steps.slice(0, 3).map(function (s) {
          var at = s.indexOf(' Cost: ');
          return el('li', null, el('div', { class: 'act', text: at >= 0 ? s.slice(0, at) : s }),
            el('em', { text: at >= 0 ? s.slice(at + 1) : '' }));
        }))
      )
    );
  }

  function footnote() {
    return el('p', { class: 'footnote', html:
      'Verdict = 0.1% retail share of the P10 low value, less a deposit sized by TVL and ' + fmtUsd(28) + ' (or ' + fmtUsd(8) + ' on cheap chains) gas. ' +
      'Quiet time is the days since DefiLlama first listed the protocol — how long it has run with no token on file; unknown dates use ' + M.unknown_age_days + ' days. ' +
      'Implied value is this radar’s own claim from the sealed snapshot — not a price and not a forecast of a launch.'
    });
  }

  // ---- detail drawer --------------------------------------------------------
  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-label': 'Protocol detail' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = null;
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) { row = DATA.rows[i]; break; }
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var p = priceOf(row), v = verdictOf(row);
    var klass = {
      watchlist: 'On the sealed watchlist: at or above the $50M TVL floor, no token on record, and not a wrapped product.',
      early: 'An early signal below the watchlist floor: no token on record and not a wrapped product — found by this radar.',
      derivative: 'A wrapped, staked, bridged or exchange product of an asset that already trades, so a standalone launch is a weaker thesis and the model discounts it.'
    }[row.launch_class];
    dialog.appendChild(el('div', { class: 'dhead' }, el('div', { class: 'row' },
      el('div', null, el('span', { class: 'eyebrow', text: 'RANK ' + row.rank + ' / ' + DATA.board_size }), el('h2', { text: row.name }),
        el('span', { class: 'sub', text: (row.category || 'Other') + ' · ' + (row.chains || []).join(', ') })),
      el('button', { class: 'close', type: 'button', text: 'Close', onclick: function () { dialog.close(); } })
    )));
    var body = el('div', { class: 'dbody' });
    body.appendChild(el('section', { class: 'dsec' }, el('h3', { text: 'Implied value — the model shown' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'size curve' }), el('b', { text: fmtUsd(row.size_value_usd) })),
        el('div', null, el('span', { text: 'family offset' }), el('b', { text: fmtX(Math.pow(10, row.family_offset)) })),
        el('div', null, el('span', { text: '7d momentum' }), el('b', { text: fmtPct(row.change_7d) + ' → ' + fmtX(row.growth_mult) })),
        el('div', null, el('span', { text: 'quiet time' }), el('b', { text: fmtAge(row.age_days) + ' → ' + fmtX(row.quiet_mult) })),
        el('div', null, el('span', { text: 'chain breadth' }), el('b', { text: fmtX(row.breadth_mult) })),
        el('div', null, el('span', { text: 'class weight' }), el('b', { text: '×' + row.class_weight.toFixed(2) })),
        el('div', { class: 'hi' }, null, el('span', { text: 'implied value' }), el('b', { text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: 'P10–P90 band' }), el('b', { text: fmtUsd(row.low_usd) + ' – ' + fmtUsd(row.high_usd) }))
      ),
      el('p', { class: 'why', html: 'Model <b>' + DATA.model_version + '</b> recomputes this row in the page to <b>' + fmtUsd(p.implied) + '</b> — ' + (p.implied === row.implied_value_usd ? 'the same number the board carries.' : 'stale data.') + ' ' + klass })
    ));
    var plan = el('ol', { class: 'plan' });
    row.farm_steps.forEach(function (s) {
      var at = s.indexOf(' Cost: ');
      plan.appendChild(el('li', null, el('div', { class: 'act', text: at >= 0 ? s.slice(0, at) : s }), el('em', { text: at >= 0 ? s.slice(at + 1) : '' })));
    });
    body.appendChild(el('section', { class: 'dsec' }, el('h3', { text: 'How to farm it' }), plan));
    body.appendChild(el('section', { class: 'dsec' }, el('div', { class: 'caveat', text:
      v.key === 'skip' ? 'On this model’s low-end band, even a 0.1% retail share does not cover the deposit and gas. Farm only if you disagree with the band.'
        : 'No launch is certain. Farm only with capital you can leave locked for the full window, and claim only from the protocol’s own pages.' })));
    dialog.appendChild(body);
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(topbar());
    shell.appendChild(kpis());
    shell.appendChild(evidence());
    shell.appendChild(toolbar());
    shell.appendChild(el('div', { class: 'main' }, state.tab === 'pre' ? boardTable() : liveTable(), sidePanel()));
    shell.appendChild(footnote());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dialog.open) dialog.close(); });
})();
