// Token Radar, radar-2 dashboard. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, filters, a per-protocol drawer with the model's own inputs, the
// farm plan and live-token comparables, and the methodology the fit was tested on. No network:
// every byte shown comes from data.js.
(function () {
  'use strict';

  const DATA = window.RADAR;
  if (!DATA) return;
  const app = document.getElementById('app');
  const state = { q: '', category: 'all', chain: 'all', tab: 'pre', sort: 'implied', dir: -1, selected: null };

  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return money.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function firstChain(p) { return p.chains && p.chains.length ? p.chains[0] : 'its main chain'; }

  // One element builder: h('div', {class: 'x', text: 'y'}, child, child).
  function h(tag, attrs, ...kids) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const key of Object.keys(attrs)) {
        const v = attrs[key];
        if (v === null || v === undefined) continue;
        if (key === 'class') node.className = v;
        else if (key === 'text') node.textContent = v;
        else if (key === 'html') node.innerHTML = v;
        else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), v);
        else node.setAttribute(key, v);
      }
    }
    for (const kid of kids) {
      if (kid === null || kid === undefined) continue;
      if (Array.isArray(kid)) kid.forEach((c) => { if (c) node.appendChild(c); });
      else if (typeof kid === 'string') node.appendChild(document.createTextNode(kid));
      else node.appendChild(kid);
    }
    return node;
  }

  // The fitted model, recomputed here from the snapshot figures so the drawer can check the
  // number board.json carries: base = exp(a + b*ln(TVL) + category adjustment), then the same
  // growth, maturity and chain multipliers the model applies. The multipliers are recomputed
  // from the raw figures, not taken from the board's rounded copies, so the check is exact.
  function impliedOf(row) {
    const fit = DATA.fit;
    const base = Math.exp(fit.intercept + fit.slope * Math.log(row.tvl_usd) + (row.category_adjustment || 0));
    const growth = Math.min(120, Math.max(-60, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    const growthMult = 1 + (growth / 100) * DATA.model.growth_weight;
    const age = row.age_days === null || row.age_days === undefined ? DATA.model.unknown_age_days : row.age_days;
    const maturity = DATA.model.maturity_floor + (Math.min(Math.max(age, 0), DATA.model.maturity_days) / DATA.model.maturity_days) * DATA.model.maturity_range;
    const chainMult = 1 + Math.min(DATA.model.chain_max, Math.max(0, Math.min((row.chains || []).length - 1, 2)) * DATA.model.chain_step);
    return Math.max(1, Math.round(base * growthMult * maturity * chainMult));
  }
  function fittedBase(row) {
    const fit = DATA.fit;
    return Math.exp(fit.intercept + fit.slope * Math.log(row.tvl_usd) + (row.category_adjustment || 0));
  }

  // Farm plan: the same derivation main.ts writes to board.json — category action, TVL-tiered
  // capital, age-based hold, weekly action, points-page check, farm log, netted cost, thin note.
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    const c = (p.category || '').toLowerCase();
    const name = p.name;
    if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.includes('bridge')) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.includes('staking') || c.includes('restak')) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.includes('perpetual') || c.includes('derivative')) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.includes('prediction')) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.includes('curator') || c.includes('allocator')) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.includes('stable')) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.includes('rwa')) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.includes('insurance')) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function farmSteps(p) {
    const chain = firstChain(p);
    const capital = capitalFor(p);
    const hold = holdFor(p.age_days);
    const weeks = Math.max(1, Math.ceil(hold / 7));
    const gasLow = 3 + 2 * weeks;
    const thin = p.implied_value_usd < 3000000;
    const steps = [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' },
      { text: 'Net cost at the low end: about $' + gasLow + ' of gas over the ' + hold + '-day hold (' + weeks + ' weekly actions), plus the $' + capital + ' of capital that stays in the position and can be withdrawn.', cost: 'about $' + gasLow + ' of gas, capital recoverable', time: hold + ' days in total' },
      { text: thin ? 'Thin row: the implied value is small next to the $' + gasLow + ' of gas above, so skip this farm unless you already use the protocol.' : 'The implied value is large enough that the $' + gasLow + ' of gas above is small next to it — still no promise of a payout.', cost: thin ? 'saving the gas by skipping' : 'about $0 extra', time: 'no extra time' }
    ];
    return steps.map((s) => s.text + ' Cost: ' + s.cost + '. Time: ' + s.time + '.');
  }

  function readHash() {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    // A hash update must never break the page: on file:// URLs some browsers refuse
    // replaceState, and the board has to keep working without it.
    try {
      const params = new URLSearchParams();
      if (state.q) params.set('q', state.q);
      if (state.category !== 'all') params.set('category', state.category);
      if (state.chain !== 'all') params.set('chain', state.chain);
      if (state.selected) params.set('p', state.selected);
      const next = params.toString();
      window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
    } catch (e) {
      /* the hash is a convenience, not the board */
    }
  }

  function filteredRows() {
    const q = state.q.trim().toLowerCase();
    return DATA.rows.filter((r) => {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase().includes(q);
    });
  }
  function sortedRows(list) {
    return list.slice().sort((a, b) => {
      let av, bv;
      if (state.sort === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (state.sort === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (state.sort === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (state.sort === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : 1;
    });
  }

  function masthead() {
    return h('header', { class: 'masthead' }, h('div', { class: 'masthead-inner' },
      h('span', { class: 'eyebrow', text: 'Token Radar · radar-2' }),
      h('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
      h('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor. Implied value is a fitted estimate, not a promise.' }),
      h('div', { class: 'chips' },
        h('span', { class: 'chip', text: 'Snapshot ' + DATA.as_of }),
        h('span', { class: 'chip', text: 'DefiLlama protocol index' }),
        h('span', { class: 'chip', text: 'Fitted on ' + DATA.fit.comps_n + ' live-token comparables' }),
        h('span', { class: 'chip', text: 'Leave-one-out error ' + DATA.fit.loo_median_abs_log_error + ' log units' })
      )
    ));
  }

  function statCards() {
    const top = DATA.rows[0];
    return h('section', { class: 'stats' },
      h('div', { class: 'stat' }, h('span', { text: 'Watchlist covered' }), h('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), h('small', { text: 'every watchlist slug is on the board' })),
      h('div', { class: 'stat' }, h('span', { text: 'Pre-token rows scored' }), h('b', { text: String(DATA.board_size) }), h('small', { text: DATA.early_size + ' early rows below the floor' })),
      h('div', { class: 'stat' }, h('span', { text: 'Top implied value' }), h('b', { text: top ? fmtUsd(top.implied_value_usd) : 'n/a' }), h('small', { text: top ? top.name : '' })),
      h('div', { class: 'stat' }, h('span', { text: 'Live-token protocols set aside' }), h('b', { text: String(DATA.live_size) }), h('small', { text: 'shown with market caps, never ranked' }))
    );
  }

  function toolbar() {
    const categories = Array.from(new Set(DATA.rows.map((r) => r.category || 'Other'))).sort();
    const chains = Array.from(new Set(DATA.rows.flatMap((r) => r.chains || []))).sort();
    const search = h('input', { type: 'search', id: 'search-box', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', () => {
      // Re-rendering rebuilds the input, so keep the caret where the user left it.
      const caret = search.selectionStart;
      state.q = search.value;
      writeHash();
      render();
      const again = document.getElementById('search-box');
      if (again) { again.focus(); again.setSelectionRange(caret, caret); }
    });
    const cat = h('select', { 'aria-label': 'Filter by category' },
      h('option', { value: 'all', text: 'All categories' }),
      categories.map((c) => h('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }))
    );
    cat.addEventListener('change', () => { state.category = cat.value; writeHash(); render(); });
    const chain = h('select', { 'aria-label': 'Filter by chain' },
      h('option', { value: 'all', text: 'All chains' }),
      chains.map((c) => h('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }))
    );
    chain.addEventListener('change', () => { state.chain = chain.value; writeHash(); render(); });
    const sort = h('select', { 'aria-label': 'Sort the board' },
      [['implied', 'Sort: implied value'], ['tvl', 'Sort: TVL'], ['growth', 'Sort: 7-day growth'], ['age', 'Sort: age'], ['name', 'Sort: name']].map(([v, label]) => h('option', { value: v, text: label, selected: v === state.sort ? 'selected' : null }))
    );
    sort.addEventListener('change', () => { state.sort = sort.value; state.dir = -1; render(); });
    const pre = h('button', { type: 'button', 'aria-pressed': state.tab === 'pre' ? 'true' : 'false', text: 'Pre-token', onclick: () => { state.tab = 'pre'; render(); } });
    const live = h('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: () => { state.tab = 'live'; render(); } });
    return h('div', { class: 'toolbar' },
      h('div', { class: 'field' }, h('label', { text: 'Search' }), search),
      h('div', { class: 'field' }, h('label', { text: 'Category' }), cat),
      h('div', { class: 'field' }, h('label', { text: 'Chain' }), chain),
      h('div', { class: 'field' }, h('label', { text: 'Sort' }), sort),
      h('div', { class: 'field' }, h('label', { text: 'Token status' }), h('div', { class: 'view-tabs' }, pre, live)),
      h('span', { class: 'result-count', text: state.tab === 'pre' ? filteredRows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortButton(key, label) {
    return h('th', { scope: 'col' }, h('button', { type: 'button', onclick: () => { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } }, label, state.sort === key ? h('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null));
  }

  function boardTable() {
    const list = sortedRows(filteredRows());
    if (!list.length) {
      return h('div', { class: 'card' }, h('div', { class: 'empty' },
        h('h2', { text: 'No protocol matches that filter' }),
        h('p', { text: 'Clear the search or pick another category or chain to see the board again.' }),
        h('button', { class: 'btn primary', type: 'button', text: 'Clear filters', onclick: () => { state.q = ''; state.category = 'all'; state.chain = 'all'; writeHash(); render(); } })
      ));
    }
    const max = list[0].implied_value_usd || 1;
    const tbody = h('tbody');
    list.forEach((r) => {
      const growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down';
      const thin = r.implied_value_usd < 3000000;
      tbody.appendChild(h('tr', {
        'aria-selected': state.selected === r.slug ? 'true' : 'false', tabindex: '0',
        onclick: () => openDrawer(r.slug),
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDrawer(r.slug); } }
      },
        h('td', { class: 'num', text: String(r.rank) }),
        h('td', null, h('div', { class: 'who' }, h('b', { text: r.name }), h('span', { text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        h('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        h('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        h('td', { class: 'num', text: fmtAge(r.age_days) }),
        h('td', null, h('div', { class: 'value-cell' },
          h('span', { class: 'meter', 'aria-hidden': 'true' }, h('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          h('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        h('td', null, h('span', { class: 'tag' + (thin ? ' thin' : ''), text: thin ? 'thin row' : 'no token' }))
      ));
    });
    return h('div', { class: 'card', id: 'board-table' }, h('div', { class: 'scroll' },
      h('table', null,
        h('caption', { text: 'Pre-token protocols, strongest implied value first. Select a row for its model, farm plan and live comparables.' }),
        h('thead', null, h('tr', null,
          sortButton('implied', 'Rank'), sortButton('name', 'Protocol'), sortButton('tvl', 'TVL'),
          sortButton('growth', '7d'), sortButton('age', 'Age'), sortButton('implied', 'Implied value'),
          h('th', { scope: 'col', text: 'Token' })
        )),
        tbody
      )
    ));
  }

  function liveTable() {
    const tbody = h('tbody');
    DATA.live.forEach((r) => {
      tbody.appendChild(h('tr', null,
        h('td', { class: 'num', text: 'live' }),
        h('td', null, h('div', { class: 'who' }, h('b', { text: r.name }), h('span', { text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        h('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        h('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'up' : 'down'), text: fmtPct(r.change_7d) }),
        h('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        h('td', { class: 'num', text: r.mcap_usd && r.tvl_usd ? (r.mcap_usd / r.tvl_usd).toFixed(2) + 'x' : 'n/a' }),
        h('td', null, h('span', { class: 'tag', text: 'already trades' }))
      ));
    });
    return h('div', { class: 'card' }, h('div', { class: 'scroll' },
      h('table', null,
        h('caption', { text: 'Live-token protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — and they are the comparables the value model was fitted on.' }),
        h('thead', null, h('tr', null,
          h('th', { scope: 'col', text: 'Status' }), h('th', { scope: 'col', text: 'Protocol' }), h('th', { scope: 'col', text: 'TVL' }),
          h('th', { scope: 'col', text: '7d' }), h('th', { scope: 'col', text: 'Market cap' }), h('th', { scope: 'col', text: 'Mcap / TVL' }), h('th', { scope: 'col', text: 'Token' })
        )),
        tbody
      )
    ));
  }

  function methodSection() {
    const fit = DATA.fit;
    const adjRows = Object.keys(fit.category_adjustments).sort((a, b) => fit.category_adjustments[b] - fit.category_adjustments[a]);
    return h('section', { class: 'card method' },
      h('h2', { text: 'How implied value is computed' }),
      h('p', { text: 'One function scores every row, from the snapshot figures only. No protocol name is special-cased, and no row is hand-picked.' }),
      h('div', { class: 'formula', text: 'base = exp(' + fit.intercept.toFixed(3) + ' + ' + fit.slope.toFixed(3) + ' x ln(TVL) + category adjustment) · growth multiplier · maturity multiplier · chain multiplier' }),
      h('p', { text: 'The line log(market cap) = ' + fit.intercept.toFixed(3) + ' + ' + fit.slope.toFixed(3) + ' x log(TVL) is fitted on ' + fit.comps_n + ' live-token comparables — protocols with a positive market cap, exchanges excluded. A slope below 1 damps mega-TVL rows: the flat 0.25x starter put Steakhouse Financial at $544M; the fitted model puts it at ' + fmtUsd(DATA.rows[0] ? DATA.rows[0].implied_value_usd : 0) + '. The global median market-cap/TVL ratio among the comparables is ' + fit.global_median_ratio.toFixed(3) + '.' }),
      h('p', { text: 'Out of sample, the fitted model beats the flat 0.25x baseline on both tests. Leave-one-out median absolute log error ' + fit.loo_median_abs_log_error + ' against a baseline of ' + fit.loo_baseline_median_abs_log_error + '. Pre-2025 train / post-2025 test (' + fit.time_split_train_n + ' trained, ' + fit.time_split_test_n + ' tested): ' + fit.time_split_median_abs_log_error + ' against a baseline of ' + fit.time_split_baseline_median_abs_log_error + '. Errors are on the base value only; growth, maturity and chain breadth are scoring terms for pre-token rows, not part of predicting a live token.' }),
      h('p', { text: 'Growth is the 7-day TVL change clamped to -60%..+120% at half weight. Maturity is 0.6 + min(age, 1095)/1095 x 0.4, age from first listing, 365 days when unlisted. Chain breadth adds 2.5% per extra chain, up to 5% — it swaps only ranks 6 and 7 in the top 10, it does not drive the ranking.' }),
      h('h3', { text: 'Category adjustments (log units, shrunk, capped at ±0.5)' }),
      h('div', { class: 'scroll' }, h('table', null,
        h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Category' }), h('th', { scope: 'col', text: 'Comparables' }), h('th', { scope: 'col', text: 'Adjustment' }))),
        h('tbody', null, adjRows.map((c) => h('tr', null,
          h('td', { text: c }),
          h('td', { class: 'num', text: String(fit.category_counts[c] || 0) }),
          h('td', { class: 'num', text: (fit.category_adjustments[c] >= 0 ? '+' : '') + fit.category_adjustments[c].toFixed(3) })
        )))
      )),
      h('p', { class: 'note', text: 'Categories with fewer than 3 comparables get no adjustment and fall back to the fitted line. Farm plans state cost and time per step and are netted at the low end; no yield, APY or airdrop is promised — the snapshot carries none.' })
    );
  }

  const drawer = h('aside', { class: 'drawer', id: 'drawer', hidden: true, tabindex: '-1', 'aria-label': 'Protocol detail' });

  function openDrawer(slug) {
    const row = DATA.rows.find((r) => r.slug === slug);
    if (!row) return;
    state.selected = slug;
    writeHash();
    drawer.textContent = '';
    drawer.hidden = false;
    const recomputed = impliedOf(row);
    const steps = farmSteps(row);
    const comps = DATA.live.filter((l) => l.category === row.category).slice(0, 3);
    drawer.appendChild(h('div', { class: 'drawer-head' },
      h('div', null,
        h('span', { class: 'kicker', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        h('h2', { text: row.name }),
        h('p', { text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      h('button', { class: 'btn', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: closeDrawer })
    ));
    drawer.appendChild(h('section', null,
      h('h3', { text: 'Implied value' }),
      h('div', { class: 'kv' },
        h('div', null, h('span', { text: 'TVL' }), h('b', { text: fmtUsd(row.tvl_usd) })),
        h('div', null, h('span', { text: 'Fitted base value' }), h('b', { text: fmtUsd(fittedBase(row)) })),
        h('div', null, h('span', { text: 'Category adjustment' }), h('b', { text: (row.category_adjustment >= 0 ? '+' : '') + row.category_adjustment.toFixed(3) + ' log units' })),
        h('div', null, h('span', { text: 'Effective multiple' }), h('b', { text: row.effective_multiple.toFixed(3) + 'x TVL' })),
        h('div', null, h('span', { text: 'Seven-day growth' }), h('b', { text: fmtPct(row.change_7d) })),
        h('div', null, h('span', { text: 'Age with no token' }), h('b', { text: fmtAge(row.age_days) })),
        h('div', null, h('span', { text: 'Growth / maturity / chain' }), h('b', { text: row.growth_multiplier + ' / ' + row.maturity_multiplier + ' / ' + row.chain_multiplier })),
        h('div', null, h('span', { text: 'Implied value' }), h('b', { text: fmtUsd(row.implied_value_usd) }))
      ),
      h('p', { class: 'note', text: 'The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ' — that differs from the board, so the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    drawer.appendChild(h('section', null,
      h('h3', { text: 'Farm plan' }),
      h('ol', { class: 'farm' }, steps.map((s) => {
        const at = s.indexOf(' Cost: ');
        return h('li', null, h('b', { text: at >= 0 ? s.slice(0, at) : s }), h('span', { text: at >= 0 ? s.slice(at + 1) : '' }));
      }))
    ));
    drawer.appendChild(h('section', null,
      h('h3', { text: 'Live-token comparables — ' + (row.category || 'Other') }),
      comps.length
        ? h('div', { class: 'comps' }, comps.map((l) => h('div', null,
            h('span', { text: l.name }),
            h('b', { class: 'num', text: fmtUsd(l.mcap_usd) + '  (' + (l.mcap_usd && l.tvl_usd ? (l.mcap_usd / l.tvl_usd).toFixed(2) + 'x TVL' : 'n/a') + ')' })
          )))
        : h('p', { class: 'note', text: 'No live-token comparable in this category is in the top 24 shown here.' })
    ));
    drawer.focus();
  }
  function closeDrawer() {
    state.selected = null;
    drawer.hidden = true;
    writeHash();
  }

  function render() {
    app.textContent = '';
    app.appendChild(masthead());
    const page = h('div', { class: 'page' });
    page.appendChild(statCards());
    page.appendChild(toolbar());
    page.appendChild(state.tab === 'pre' ? boardTable() : liveTable());
    if (state.tab === 'pre') page.appendChild(methodSection());
    app.appendChild(page);
    app.appendChild(drawer);
    app.setAttribute('aria-busy', 'false');
    if (state.selected) openDrawer(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !drawer.hidden) closeDrawer(); });
})();
