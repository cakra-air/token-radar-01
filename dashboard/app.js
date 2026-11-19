// RADAR dashboard — renders the sealed snapshot's board with no network.
// Everything shown comes from window.RADAR (written by main.ts next to this page).
//
// The model lives here in `priceOf`, the same arithmetic lib/model.ts uses to
// write board.json. It fits a size curve to the protocols that already trade,
// adds a category residual, then adjusts by momentum, quiet days and breadth.
// Every input is a snapshot figure, never a list of names, so a future snapshot
// yields a future board. `openDetail` recomputes each row and prints the number
// beside the board's, so the page and the data visibly agree.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('app');
  var C = DATA.ctx;
  var M = DATA.model;
  var state = { q: '', category: 'all', cls: 'all', verdict: 'all', tab: 'pre', sort: 'implied', dir: -1, selected: null };

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
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + Number(n).toFixed(2) + '%';
  }
  function fmtAge(d) {
    if (d === null || d === undefined) return 'unknown';
    if (d >= 365) return (d / 365).toFixed(1) + 'y';
    return Math.round(d) + 'd';
  }
  function fmtMult(n) { return '×' + Number(n).toFixed(2); }

  // ---- the value model, in the page's own source ----------------------------
  // sizeCurve(TVL) x family x momentum x quiet x breadth x class, all from
  // snapshot figures. The fit constants come from the traded comps in data.js.
  function priceOf(row) {
    var tvl = row.tvl_usd > 0 ? row.tvl_usd : 1;
    var size = Math.pow(10, C.slope * (Math.log(tvl) / Math.LN10) + C.intercept);
    var family = row.family_offset;
    var core = size * Math.pow(10, family) * row.growth_mult * row.quiet_mult * row.breadth_mult;
    var clamp = function (n) { return Math.max(1, Math.min(100000000000000, Math.round(n))); };
    return {
      implied: clamp(core * row.class_weight),
      low: clamp(core * Math.pow(10, C.resid_p10) * row.class_weight),
      high: clamp(core * Math.pow(10, C.resid_p90) * row.class_weight)
    };
  }

  // A verdict from the value's own band: is farming worth the capital?
  // A retail farmer's share of a launch is small, so assume 0.1% of the band's
  // low end, then subtract the position and gas. Every input is stated.
  function verdictOf(row) {
    var cheap = /solana|ton|sui|aptos|near|sei|injective|celo|base|arbitrum|optimism|polygon|avalanche|bsc|bnb|fantom|sonic|berachain|scroll|linea|blast|ink|monad/.test((row.chains[0] || '').toLowerCase());
    var gas = cheap ? 8 : 28;
    var capital = row.tvl_usd >= 1e9 ? 250 : row.tvl_usd >= 1e8 ? 100 : row.tvl_usd >= 2e7 ? 50 : 25;
    var net = row.low_usd * 0.001 - capital - gas;
    if (row.launch_class === 'derivative') return { key: 'skip', label: 'Watch', net: net };
    if (net > 75) return { key: 'farm', label: 'Farm', net: net };
    if (net > 0) return { key: 'thin', label: 'Thin', net: net };
    return { key: 'skip', label: 'Skip', net: net };
  }

  // ---- tiny DOM helper ------------------------------------------------------
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

  // ---- hash state, so a screenshot can open any state by URL ----------------
  function readHash() {
    var h = window.location.hash.replace(/^#/, '');
    if (!h) return;
    var p = new URLSearchParams(h);
    if (p.get('q')) state.q = p.get('q');
    if (p.get('p')) state.selected = p.get('p');
    if (p.get('class')) state.cls = p.get('class');
    if (p.get('category')) state.category = p.get('category');
    if (p.get('verdict')) state.verdict = p.get('verdict');
    if (p.get('tab')) state.tab = p.get('tab');
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

  // ---- filtering and sorting ------------------------------------------------
  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.cls !== 'all' && r.launch_class !== state.cls) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.verdict !== 'all' && verdictOf(r).key !== state.verdict) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category || '', (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'chg') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -Infinity : a.age_days; bv = b.age_days === null ? -Infinity : b.age_days; }
      else if (key === 'rank') { av = a.rank; bv = b.rank; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // ---- page sections --------------------------------------------------------
  function topbar() {
    return el('header', { class: 'topbar' },
      el('div', { class: 'brand' },
        el('span', { class: 'mark', 'aria-hidden': 'true' }),
        el('div', null, el('b', { text: 'RADAR' }), el('span', { text: 'PRE-LAUNCH INTELLIGENCE' }))
      ),
      el('div', { class: 'topmeta' },
        el('span', { text: 'SNAPSHOT ' + DATA.as_of }),
        el('span', { text: 'DEFILLAMA PROTOCOL INDEX' }),
        el('span', { html: 'MODEL <i>' + DATA.model_version + '</i>' })
      )
    );
  }

  function hero() {
    var miss = C.holdout_median_miss;
    return el('section', { class: 'hero' },
      el('div', null,
        el('span', { class: 'eyebrow', text: 'Token launch radar' }),
        el('h1', { html: 'Find the <em>next launch</em> before it has a ticker.' }),
        el('p', { class: 'lede', html:
          'This radar fits a value curve to the <strong>' + C.n_comps + ' protocols that already trade</strong>, then prices every protocol that records no token against it. ' +
          'All <strong>' + DATA.watchlist_size + ' watchlist protocols</strong> are covered — plus ' + DATA.class_counts.early + ' earlier ones below the floor. ' +
          'Each row carries a costed plan. Implied value is this radar’s own estimate, not a price or a promise of a launch.'
        })
      ),
      el('div', { class: 'kpis' },
        el('div', { class: 'kpi' }, el('span', { text: 'Pre-token priced' }), el('b', { text: String(DATA.board_size) }), el('small', { text: 'every no-token record in the snapshot' })),
        el('div', { class: 'kpi' }, el('span', { text: 'Watchlist covered' }), el('b', { class: 'mint', text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('small', { text: 'the floor, never the ceiling' })),
        el('div', { class: 'kpi' }, el('span', { text: 'Out-of-sample miss' }), el('b', { class: 'amber', text: '×' + miss.toFixed(2) }), el('small', { text: C.holdout_n + ' held-out comps, priced blind' })),
        el('div', { class: 'kpi' }, el('span', { text: 'Within 2× blind' }), el('b', { text: Math.round(C.holdout_within_2x * 100) + '%' }), el('small', { text: 'of the held-out traded protocols' }))
      )
    );
  }

  function method() {
    return el('section', { class: 'method' },
      el('div', null,
        el('h2', { text: 'How implied value is computed' }),
        el('div', { class: 'formula', html:
          'size = 10^( <u>' + C.slope + '</u> · log10(TVL) + <u>' + C.intercept + '</u> ) &nbsp; fitted on ' + C.n_comps + ' traded comps<br>' +
          'implied = round( size × 10^(family offset) × momentum × quiet × breadth × class ) &nbsp; ' +
          'P10–P90 band = ×' + Math.pow(10, C.resid_p10).toFixed(2) + ' … ×' + Math.pow(10, C.resid_p90).toFixed(2)
        })
      ),
      el('div', { class: 'factors' },
        el('span', { class: 'factor', html: '<b>size curve</b> · traded comps' }),
        el('span', { class: 'factor', html: '<b>family</b> · category residual' }),
        el('span', { class: 'factor', html: '<b>7d + quiet</b> · momentum and time' }),
        el('span', { class: 'factor', html: '<b>class</b> · wrapped products discounted' })
      )
    );
  }

  function toolbar() {
    var categories = ['all'].concat(Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort());
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, chain or category', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var cat = el('select', { id: 'cat', 'aria-label': 'Filter by category' },
      categories.map(function (c) { return el('option', { value: c, text: c === 'all' ? 'All categories' : c, selected: c === state.category ? 'selected' : null }); })
    );
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var clsLbl = { all: 'All signals', watchlist: 'Watchlist', early: 'Early', derivative: 'Watch list' };
    var cls = el('select', { id: 'cls', 'aria-label': 'Filter by signal class' },
      Object.keys(clsLbl).map(function (c) { return el('option', { value: c, text: clsLbl[c], selected: c === state.cls ? 'selected' : null }); })
    );
    cls.addEventListener('change', function () { state.cls = cls.value; writeHash(); render(); });
    var vLbl = { all: 'Any verdict', farm: 'Farm', thin: 'Thin', skip: 'Skip / Watch' };
    var ver = el('select', { id: 'ver', 'aria-label': 'Filter by farm verdict' },
      Object.keys(vLbl).map(function (c) { return el('option', { value: c, text: vLbl[c], selected: c === state.verdict ? 'selected' : null }); })
    );
    ver.addEventListener('change', function () { state.verdict = ver.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    var n = state.tab === 'pre' ? rows().length : DATA.live.length;
    return el('div', { class: 'toolbar' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'cat', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'cls', text: 'Signal' }), cls),
      el('div', { class: 'field' }, el('label', { for: 'ver', text: 'Verdict' }), ver),
      el('div', { class: 'field' }, el('label', { text: 'Token status' }), el('div', { class: 'segmented' }, pre, live)),
      el('span', { class: 'count', html: '<b>' + n + '</b> / ' + (state.tab === 'pre' ? DATA.board_size : DATA.live.length) + ' shown' })
    );
  }

  function sortTh(key, label) {
    var on = state.sort === key;
    return el('th', { scope: 'col' },
      el('button', {
        type: 'button', class: on ? 'on' : '',
        text: label + (on ? (state.dir < 0 ? ' ↓' : ' ↑') : ''),
        onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'rank' ? 1 : -1; } render(); }
      })
    );
  }

  function classTag(c) {
    var label = c === 'watchlist' ? 'watchlist' : c === 'early' ? 'early' : 'watch';
    return el('span', { class: 'tag ' + c, text: label });
  }

  function bandCell(row) {
    var lo = Math.log(Math.max(1, row.low_usd));
    var hi = Math.log(Math.max(2, row.high_usd));
    var iv = Math.log(Math.max(1, row.implied_value_usd));
    var pct = Math.max(2, Math.min(98, Math.round((iv - lo) / (hi - lo) * 100)));
    return el('div', { class: 'band' },
      el('div', { class: 'band-track' }, el('i', { style: 'left:' + pct + '%' })),
      el('span', { class: 'band-lbl', text: fmtUsd(row.low_usd) + ' – ' + fmtUsd(row.high_usd) })
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or choose another filter to see the board again.' }),
        el('button', { class: 'btn primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.cls = 'all'; state.verdict = 'all'; writeHash(); render(); } })
      ));
    }
    var lo = Math.log(Math.max(1, DATA.rows[DATA.rows.length - 1].implied_value_usd));
    var hi = Math.log(Math.max(2, DATA.top_implied_usd));
    var span = Math.max(1, hi - lo);
    var tbody = el('tbody');
    list.forEach(function (r) {
      var g = r.change_7d;
      var gcls = g === null ? 'flat' : g >= 0 ? 'up' : 'down';
      var w = Math.max(5, Math.min(100, Math.round((Math.log(Math.max(1, r.implied_value_usd)) - lo) / span * 100)));
      var v = verdictOf(r);
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false', tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'rank' + (r.rank <= 10 ? ' top' : ''), text: String(r.rank).padStart(3, '0') }),
        el('td', null, el('div', { class: 'proto' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + ((r.chains || []).slice(0, 3).join(', ')) || 'chain n/a' }),
          classTag(r.launch_class)
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num chg ' + gcls, text: fmtPct(g) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'iv' },
          el('div', { class: 'meter', 'aria-hidden': 'true' }, el('i', { style: 'width:' + w + '%' })),
          el('b', { text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, bandCell(r)),
        el('td', null, el('span', { class: 'verdict ' + v.key, text: v.label + ' ' + (v.net >= 0 ? '+$' : '−$') + Math.round(Math.abs(v.net)).toLocaleString('en-US') })),
        el('td', { class: 'arrow', text: '›' })
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { html:
            'Pre-token protocols priced by implied value · <b>' + DATA.class_counts.watchlist + '</b> watchlist · <b>' +
            DATA.class_counts.early + '</b> early · <b>' + DATA.class_counts.derivative + '</b> discounted products. Select a row for its model and farm plan.'
          }),
          el('thead', null, el('tr', null,
            sortTh('rank', 'Rank'), sortTh('name', 'Protocol'), sortTh('tvl', 'TVL'),
            sortTh('chg', '7d'), sortTh('age', 'Quiet'), sortTh('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'P10–P90 band' }), el('th', { scope: 'col', text: 'Verdict' }),
            el('th', { scope: 'col', text: '' })
          )), tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'state', text: 'live' }),
        el('td', null, el('div', { class: 'proto' }, el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + ((r.chains || []).slice(0, 3).join(', ')) || 'chain n/a' }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num chg ' + (r.change_7d === null ? 'flat' : r.change_7d >= 0 ? 'up' : 'down'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'state', text: r.symbol || 'token' })
      ));
    });
    return el('div', { class: 'panel' }, el('div', { class: 'table-wrap' }, el('table', null,
      el('caption', { text: 'Token already trades: the market’s own market cap, not a model. These ' + C.n_comps + ' comps set the size curve; they are set aside from the ranking.' }),
      el('thead', null, el('tr', null, el('th', { text: 'Status' }), el('th', { text: 'Protocol' }), el('th', { text: 'TVL' }), el('th', { text: '7d' }), el('th', { text: 'Market cap' }), el('th', { text: 'Symbol' }))),
      tbody
    )));
  }

  function footnote() {
    return el('p', { class: 'footnote', html:
      '<b>Evidence.</b> The curve is fitted by least squares on log10(TVL) → log10(market cap) across ' + C.n_comps + ' traded protocols, then tested blind on ' +
      C.holdout_n + ' of them (median miss ×' + C.holdout_median_miss.toFixed(2) + '; ' + Math.round(C.holdout_within_2x * 100) + '% within 2×). ' +
      'Family offsets come from the traded comps in the same category. Quiet time is the days since DefiLlama first listed the protocol — a record of how long it has run with no token on file; an unknown date uses ' +
      M.unknown_age_days + ' days. The verdict assumes a position sized by TVL and a 0.1% retail share of the band’s low end, net of gas. Implied value is this radar’s claim, not make.fun’s, not a forecast of whether a token is issued.'
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
    var p = priceOf(row);
    var agree = p.implied === row.implied_value_usd;
    var v = verdictOf(row);
    var klass = {
      watchlist: 'On the sealed watchlist: at or above the $50M TVL floor, no token on record, and not a wrapped product.',
      early: 'An early signal below the watchlist floor: no token on record and not a wrapped product — found by this radar.',
      derivative: 'DefiLlama records a wrapped, staked, bridged or exchange product of an asset that already trades, so a standalone launch is a weaker thesis and the model discounts it.'
    }[row.launch_class];

    dialog.appendChild(el('div', { class: 'dhead' }, el('div', { class: 'row' },
      el('div', null,
        el('span', { class: 'eyebrow', text: 'RANK ' + row.rank + ' OF ' + DATA.board_size }),
        el('h2', { text: row.name }),
        el('span', { class: 'sub', text: (row.category || 'Other') + ' · ' + ((row.chains || []).join(', ')) })
      ),
      el('button', { class: 'close', type: 'button', text: 'Close', onclick: function () { dialog.close(); } })
    )));

    var body = el('div', { class: 'dbody' });
    body.appendChild(el('section', { class: 'dsec' },
      el('h3', { text: 'Implied value — the model, shown' }),
      el('div', { class: 'equation' },
        el('div', { class: 'egrow' }, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) })),
        el('div', { class: 'egrow' }, el('span', { text: 'Size curve from ' + C.n_comps + ' traded comps' }), el('b', { text: fmtUsd(row.size_value_usd) })),
        el('div', { class: 'egrow' }, el('span', { text: 'Family offset (' + (row.category || 'Other') + ')' }), el('b', { text: '×' + Math.pow(10, row.family_offset).toFixed(3) })),
        el('div', { class: 'egrow' }, el('span', { text: '7-day momentum' }), el('b', { text: fmtPct(row.change_7d) + ' → ' + fmtMult(row.growth_mult) })),
        el('div', { class: 'egrow' }, el('span', { text: 'Quiet time with no token' }), el('b', { text: fmtAge(row.age_days) + ' → ' + fmtMult(row.quiet_mult) })),
        el('div', { class: 'egrow' }, el('span', { text: 'Chain breadth (' + row.chains.length + ' chains)' }), el('b', { text: fmtMult(row.breadth_mult) })),
        el('div', { class: 'egrow' }, el('span', { text: 'Class weight' }), el('b', { text: '×' + row.class_weight.toFixed(2) })),
        el('div', { class: 'egrow hi' }, el('span', { text: 'Implied value' }), el('b', { text: fmtUsd(row.implied_value_usd) })),
        el('div', { class: 'egrow' }, el('span', { text: 'P10–P90 band' }), el('b', { text: fmtUsd(row.low_usd) + ' – ' + fmtUsd(row.high_usd) }))
      ),
      el('p', { class: 'why', html:
        'Model <b>' + DATA.model_version + '</b> recomputes this row in the page to <b>' + fmtUsd(p.implied) + '</b> — ' +
        (agree ? 'the same number the board carries.' : 'different from the board: the data would be stale.') + ' ' + klass
      })
    ));

    var plan = el('ol', { class: 'plan' });
    row.farm_steps.forEach(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      var meta = el('div', { class: 'meta' });
      tail.split('. ').forEach(function (bit) {
        var b = bit.replace(/\.$/, '').trim();
        if (b) meta.appendChild(el('em', { text: b }));
      });
      plan.appendChild(el('li', null, el('div', { class: 'act', text: action }), meta));
    });
    body.appendChild(el('section', { class: 'dsec' }, el('h3', { text: 'How to farm it' }), plan));

    var caveat = row.launch_class === 'derivative'
      ? 'This is a product of an asset that already trades. Treat any points program as secondary and keep the position small.'
      : v.key === 'skip'
        ? 'On this model’s low-end band, even a 0.1% retail share does not cover the deposit and gas. Farm only if you disagree with the band.'
        : row.change_7d !== null && row.change_7d < -5
          ? 'Seven-day TVL is down ' + Math.abs(row.change_7d).toFixed(1) + '%. Start small and re-check the trend before adding.'
          : 'No launch is certain. Farm only with capital you can leave locked for the full window, and claim only from the protocol’s own pages.';
    body.appendChild(el('section', { class: 'dsec' }, el('div', { class: 'caveat', text: caveat })));
    dialog.appendChild(body);

    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
  }

  // ---- render ---------------------------------------------------------------
  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(topbar());
    shell.appendChild(hero());
    shell.appendChild(method());
    shell.appendChild(toolbar());
    shell.appendChild(state.tab === 'pre' ? boardTable() : liveTable());
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
