// token-radar-01 — value model and board builder
// -----------------------------------------------------------------------------
// One sealed snapshot in, one ranked board out. Every number below comes from
// the snapshot's own ten fields; no protocol name is ever special-cased, so a
// future snapshot yields a future board.
//
// Model "radar-3" prices a would-be launch the way a comps analyst would:
//
//   1. FIT A SIZE CURVE from the protocols that already record a token.
//      OLS of log10(mcap_usd) on log10(tvl_usd) over every traded protocol in
//      the snapshot (CEX excluded). This is the market's own size relationship,
//      measured on this snapshot, not a hand-picked multiple.
//   2. ADD A FAMILY OFFSET: the median log-residual of the traded comps in the
//      same category, so a lending protocol is priced off lending comps.
//   3. ADJUST BY THE SNAPSHOT'S OTHER SIGNALS: 7-day momentum, quiet days since
//      listing (time on record with no token), chain breadth.
//   4. DISCOUNT WRAPPED / STAKED / BRIDGED / EXCHANGE PRODUCTS of an asset that
//      already trades — the house's own watchlist rule leaves them out.
//   5. REPORT AN OUT-OF-SAMPLE CHECK: fit on half the comps, price the other
//      half, and publish the median miss. A model that only fits its training
//      rows is not evidence of anything.
//
//   implied = round( sizeCurve(TVL) x 10^familyOffset x momentum x quiet x
//                    breadth x classWeight )
//
// The board is the whole pre-token universe (no market cap, no CoinGecko id,
// no symbol). The watchlist is the floor; the rest are the early signals this
// radar exists to find. Live-token protocols stay out of the ranking and are
// shown separately with the market's own market caps.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  quiet_floor: number;
  quiet_range: number;
  quiet_days: number;
  unknown_age_days: number;
  breadth_weight: number;
  breadth_cap: number;
  derivative_weight: number;
  family_clamp: number;
  holdout_share: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.60,
  growth_floor: -40,
  growth_cap: 120,
  quiet_floor: 0.92,
  quiet_range: 0.20,
  quiet_days: 1825,
  unknown_age_days: 420,
  breadth_weight: 0.018,
  breadth_cap: 10,
  derivative_weight: 0.08,
  family_clamp: 0.45,
  holdout_share: 0.5,
};

export const MODEL_VERSION = 'radar-3';

export type LaunchClass = 'watchlist' | 'early' | 'derivative';

/** The fitted curve and its evidence, computed once from the traded comps. */
export interface ModelContext {
  slope: number;
  intercept: number;
  n_comps: number;
  family_offsets: Record<string, number>;
  family_counts: Record<string, number>;
  resid_p10: number;
  resid_p90: number;
  holdout_median_miss: number;
  holdout_n: number;
  holdout_within_2x: number;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: null;
  listed_at: string | null;
  gecko_id: null;
  symbol: null;
  launch_class: LaunchClass;
  age_days: number | null;
  implied_value_usd: number;
  low_usd: number;
  high_usd: number;
  model: {
    size_value_usd: number;
    family_offset: number;
    growth_mult: number;
    quiet_mult: number;
    breadth_mult: number;
    class_weight: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  launch_class: LaunchClass;
  implied_value_usd: number;
  low_usd: number;
  high_usd: number;
  size_value_usd: number;
  family_offset: number;
  growth_mult: number;
  quiet_mult: number;
  breadth_mult: number;
  class_weight: number;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  symbol: string | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  ctx: ModelContext;
  watchlist_size: number;
  board_size: number;
  class_counts: { watchlist: number; early: number; derivative: number };
  top_implied_usd: number;
  live: LiveRow[];
  rows: RadarRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) { super(message); this.name = 'SnapshotError'; }
}

const DAY_MS = 86_400_000;
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED = /\b(wrapped|staked|staking)\b/i;
const DERIVATIVE_CATEGORIES = new Set([
  'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX',
]);
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function round4(n: number): number { return Math.round(n * 1e4) / 1e4; }
function log10(n: number): number { return Math.log(n) / Math.LN10; }
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))));
  return s[i]!;
}

/** Whole days from the listing day to the snapshot day; null when unknown. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** True when the DefiLlama record carries no token of any kind. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** The house's watchlist quality rule, applied without the TVL floor. */
export function houseQuality(p: SnapshotProtocol): boolean {
  if (DERIVATIVE_CATEGORIES.has(p.category ?? '')) return false;
  if (VERSIONED.test(p.name) || WRAPPED.test(p.name)) return false;
  if (EXCHANGES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

/** Classify a pre-token protocol from the house's own rule, not from a name list. */
export function launchClass(p: SnapshotProtocol, watchlist: Set<string>): LaunchClass {
  if (watchlist.has(p.slug)) return 'watchlist';
  return houseQuality(p) ? 'early' : 'derivative';
}

/** OLS of log10(mcap) on log10(tvl) over a set of traded protocols. */
function fit(rows: SnapshotProtocol[]): { slope: number; intercept: number } {
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of rows) {
    const tvl = p.tvl_usd, mcap = p.mcap_usd;
    if (!(tvl > 0) || !(mcap !== null && mcap > 0)) continue;
    const x = log10(tvl), y = log10(mcap);
    n++; sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  if (n < 3) return { slope: 0.7, intercept: 0 };
  const d = n * sxx - sx * sx;
  if (!(Math.abs(d) > 1e-9)) return { slope: 0.7, intercept: 0 };
  const slope = (n * sxy - sx * sy) / d;
  return { slope, intercept: (sy - slope * sx) / n };
}

/** Median log-residual of comps in each category, clamped and shrunk by count. */
function familyOffsets(rows: SnapshotProtocol[], slope: number, intercept: number, model: ModelConstants): { offsets: Record<string, number>; counts: Record<string, number> } {
  const byFamily = new Map<string, number[]>();
  for (const p of rows) {
    if (!(p.tvl_usd > 0) || !(p.mcap_usd !== null && p.mcap_usd > 0)) continue;
    const predicted = slope * log10(p.tvl_usd) + intercept;
    const residual = log10(p.mcap_usd) - predicted;
    const key = p.category || 'Other';
    if (!byFamily.has(key)) byFamily.set(key, []);
    byFamily.get(key)!.push(residual);
  }
  const offsets: Record<string, number> = {};
  const counts: Record<string, number> = {};
  for (const [key, xs] of byFamily) {
    const raw = median(xs);
    const shrink = xs.length / (xs.length + 3);
    offsets[key] = Math.max(-model.family_clamp, Math.min(model.family_clamp, raw * shrink));
    counts[key] = xs.length;
  }
  return { offsets, counts };
}

/** Fit the size curve, family offsets and an out-of-sample check from the snapshot itself. */
export function fitContext(snapshot: Snapshot, model: ModelConstants = MODEL): ModelContext {
  const comps = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX' && p.tvl_usd > 0 && p.mcap_usd !== null && p.mcap_usd > 0)
    .slice()
    .sort((a, b) => a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
  const full = fit(comps);
  const fam = familyOffsets(comps, full.slope, full.intercept, model);
  const residuals = comps.map((p) => log10(p.mcap_usd!) - (full.slope * log10(p.tvl_usd) + full.intercept));

  // Deterministic holdout: even-indexed comps train, odd-indexed comps are priced blind.
  const train = comps.filter((_, i) => i % 2 === 0);
  const test = comps.filter((_, i) => i % 2 === 1);
  const trainFit = fit(train);
  const trainFam = familyOffsets(train, trainFit.slope, trainFit.intercept, model);
  const misses: number[] = [];
  let within2 = 0;
  for (const p of test) {
    if (!(p.tvl_usd > 0) || !(p.mcap_usd !== null && p.mcap_usd > 0)) continue;
    const famOff = trainFam.offsets[p.category || 'Other'] ?? 0;
    const pred = Math.pow(10, trainFit.slope * log10(p.tvl_usd) + trainFit.intercept + famOff);
    const ratio = pred / p.mcap_usd;
    misses.push(Math.abs(log10(ratio)));
    if (ratio >= 0.5 && ratio <= 2) within2++;
  }
  return {
    slope: round4(full.slope),
    intercept: round4(full.intercept),
    n_comps: comps.length,
    family_offsets: fam.offsets,
    family_counts: fam.counts,
    resid_p10: round4(quantile(residuals, 0.1)),
    resid_p90: round4(quantile(residuals, 0.9)),
    holdout_median_miss: round4(Math.pow(10, median(misses))),
    holdout_n: misses.length,
    holdout_within_2x: test.length > 0 ? within2 / test.length : 0,
  };
}

/** The five factors, the band and the implied value for one protocol. */
export function impliedValue(
  p: SnapshotProtocol, asOf: string, model: ModelConstants, cls: LaunchClass, ctx: ModelContext,
): {
  implied: number; low: number; high: number; size: number; family: number;
  growthMult: number; quietMult: number; breadthMult: number; classWeight: number; age: number | null;
} {
  const age = ageDays(asOf, p.listed_at);
  const size = p.tvl_usd > 0 ? Math.pow(10, ctx.slope * log10(p.tvl_usd) + ctx.intercept) : 1;
  const family = ctx.family_offsets[p.category || 'Other'] ?? 0;
  const raw = finite(p.change_7d, 0);
  const g = Math.min(model.growth_cap, Math.max(model.growth_floor, raw));
  const growthMult = 1 + (g / 100) * model.growth_weight;
  const usedAge = age ?? model.unknown_age_days;
  const quietMult = model.quiet_floor + (Math.min(Math.max(usedAge, 0), model.quiet_days) / model.quiet_days) * model.quiet_range;
  const breadthMult = 1 + model.breadth_weight * Math.min(p.chains.length, model.breadth_cap);
  const classWeight = cls === 'derivative' ? model.derivative_weight : 1;
  const core = size * Math.pow(10, family) * growthMult * quietMult * breadthMult;
  const clamp = (n: number) => Math.max(1, Math.min(100_000_000_000_000, Math.round(n)));
  return {
    implied: clamp(core * classWeight),
    low: clamp(core * Math.pow(10, ctx.resid_p10) * classWeight),
    high: clamp(core * Math.pow(10, ctx.resid_p90) * classWeight),
    size, family, growthMult, quietMult, breadthMult, classWeight, age,
  };
}

/** Capital for one position, sized by the protocol's own TVL. */
function capitalFor(tvl: number): number {
  if (tvl >= 1_000_000_000) return 250;
  if (tvl >= 100_000_000) return 100;
  if (tvl >= 20_000_000) return 50;
  return 25;
}

function gasFor(chains: string[]): { perTx: number; label: string } {
  const first = (chains[0] ?? '').toLowerCase();
  if (/solana|ton|sui|aptos|near|sei|injective|celo|base|arbitrum|optimism|polygon|avalanche|bsc|bnb|fantom|sonic|berachain|scroll|linea|blast|ink|monad/.test(first)) {
    return { perTx: 1, label: 'about $1 per transaction on ' + (chains[0] || 'its chain') };
  }
  return { perTx: 6, label: 'about $4–8 per transaction on ' + (chains[0] || 'its chain') };
}

function holdDays(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function coreAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC to ${n} on ${chain}, and where a borrow market exists borrow a small amount against it to open two qualifying positions.`;
  }
  if (c.includes('risk curators') || c.includes('capital allocator') || c.includes('vault') || c.includes('curator') || c.includes('allocator')) {
    return `Deposit $${capital} of USDC into a ${n} vault or allocation market on ${chain} and keep the receipt shares in your wallet.`;
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('farm') || c.includes('liquidity')) {
    return `Provide $${capital} of two-sided liquidity to ${n}'s deepest pool on ${chain}; keep both sides supplied rather than withdrawing after one day.`;
  }
  if (c.includes('stak') || c.includes('restak')) {
    return `Stake $${capital} of the chain's native staking asset through ${n} and hold the liquid receipt token rather than selling it.`;
  }
  if (c.includes('perpetual') || c.includes('derivative')) {
    return `Deposit $${capital} of USDC as margin on ${n} and hold one small, funded position for the full window.`;
  }
  if (c.includes('prediction')) {
    return `Fund $${capital} on ${n} and take one modest position in an active market, keeping the position until resolution.`;
  }
  if (c.includes('rwa') || c.includes('stable')) {
    return `Mint or deposit $${capital} of the stable or yield asset through ${n} on ${chain} and hold the token it issues.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${capital} of USDC to ${chain} through ${n}, then use the bridged funds once in the destination app.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${n} on ${chain} and keep the policy active through the window.`;
  }
  return `Deposit $${capital} of USDC into ${n} on ${chain} and leave the position open so it appears in weekly snapshots.`;
}

/** Six concrete farm steps, each with a cost and a time, derived from the record. */
export function farmSteps(p: SnapshotProtocol, age: number | null, cls: LaunchClass): string[] {
  const chain = p.chains[0] ?? 'its main chain';
  const capital = capitalFor(p.tvl_usd);
  const gas = gasFor(p.chains);
  const hold = holdDays(age);
  const core = coreAction(p, capital, chain);
  const trend = p.change_7d === null ? 'its 7-day change is not reported, so size the position conservatively' : p.change_7d < -5 ? `its TVL is down ${Math.abs(p.change_7d).toFixed(1)}% over seven days, so start at half this capital` : p.change_7d < 0 ? `its TVL is down ${Math.abs(p.change_7d).toFixed(1)}% over seven days, so keep the position modest` : `its TVL is up ${p.change_7d.toFixed(1)}% over seven days, so this is a growing protocol`;
  const classes: Record<LaunchClass, string> = {
    watchlist: 'This protocol is on the sealed watchlist: at least the $50M TVL floor, no token on record, and not a wrapped product.',
    early: 'This is an early signal below the watchlist floor: no token on record and not a wrapped product, found by this radar.',
    derivative: 'DefiLlama records this as a wrapped, staked, bridged or exchange product of an asset that already trades, so a standalone launch is a weaker thesis.',
  };
  const steps: Array<[string, string, string]> = [
    [
      'Open a fresh self-custody wallet funded only with the capital you intend to commit, and record its address and the date in a private farm log.',
      `$${gas.perTx} of gas to fund it`, '5 minutes',
    ],
    [core, `$${capital} of capital and ${gas.label}`, '20 minutes to set up'],
    [
      `Return once a week to add a small deposit, repay part of a borrow or rebalance the pool; note that ${trend}.`,
      `$${gas.perTx} of gas a week`, '10 minutes a week',
    ],
    [
      `Keep the position open for at least ${hold} days so it appears in several weekly snapshots and any retroactive criterion can count it.`,
      `$${capital} stays in the position`, `${hold} days`,
    ],
    [
      `Follow ${p.name}'s own channels and, if it has a forum or governance page, post one substantive comment or cast one vote; some programs weight governance.`,
      'no on-chain fee', '15 minutes',
    ],
    [
      `Claim only from ${p.name}'s own announced rewards page and never from a link sent to you; ${classes[cls]} Write the outcome in your log and unwind if the thesis changes.`,
      `no claim fee; about $${gas.perTx} to exit`, '15 minutes',
    ],
  ];
  return steps.map(([text, cost, time]) => {
    let s = `${text} Cost: ${cost}. Time: ${time}.`;
    if (s.length > 600) s = `${s.slice(0, 596)}...`;
    if (s.length < 20) s += ' Hold the position and recheck the protocol page.';
    return s;
  });
}

/** The live-token protocols, by market cap, shown separately from the ranking. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, 30)
    .map((p) => ({
      slug: p.slug, name: p.name, category: p.category, chains: p.chains,
      tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d, symbol: p.symbol,
    }));
}

/** The ranked board: every pre-token protocol, ranked by implied value. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL, ctx?: ModelContext): BoardRow[] {
  const context = ctx ?? fitContext(snapshot, model);
  const watchlist = new Set(snapshot.watchlist);
  const scored = snapshot.protocols.filter(isPreToken).map((p) => {
    const cls = launchClass(p, watchlist);
    const v = impliedValue(p, snapshot.as_of, model, cls, context);
    return { p, cls, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: null,
    listed_at: s.p.listed_at,
    gecko_id: null,
    symbol: null,
    launch_class: s.cls,
    age_days: s.age,
    implied_value_usd: s.implied,
    low_usd: s.low,
    high_usd: s.high,
    model: {
      size_value_usd: s.size,
      family_offset: s.family,
      growth_mult: s.growthMult,
      quiet_mult: s.quietMult,
      breadth_mult: s.breadthMult,
      class_weight: s.classWeight,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age, s.cls),
  }));
}

/** Compact row for data.js; the page carries the same inputs it recomputes from. */
export function radarRow(r: BoardRow): RadarRow {
  return {
    rank: r.rank, slug: r.slug, name: r.name, category: r.category, chains: r.chains,
    tvl_usd: r.tvl_usd, change_7d: r.change_7d, listed_at: r.listed_at, age_days: r.age_days,
    launch_class: r.launch_class, implied_value_usd: r.implied_value_usd,
    low_usd: r.low_usd, high_usd: r.high_usd,
    size_value_usd: r.model.size_value_usd, family_offset: r.model.family_offset,
    growth_mult: r.model.growth_mult, quiet_mult: r.model.quiet_mult,
    breadth_mult: r.model.breadth_mult, class_weight: r.model.class_weight,
    farm_steps: r.farm_steps,
  };
}

/** Everything the dashboard renders, built from the same board the gate reads. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const ctx = fitContext(snapshot, model);
  const board = buildBoard(snapshot, model, ctx);
  const counts = { watchlist: 0, early: 0, derivative: 0 } as RadarData['class_counts'];
  for (const r of board) counts[r.launch_class]++;
  const radar: RadarData = {
    as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd,
    model, model_version: MODEL_VERSION, ctx,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    class_counts: counts,
    top_implied_usd: board.length > 0 ? board[0]!.implied_value_usd : 0,
    live: liveRows(snapshot),
    rows: board.map(radarRow),
  };
  return { board, radar };
}

/** The seven gate rules this program can check before writing. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'duplicate slugs in the board';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `invented slug ${r.slug}`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug(s): ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `board has ${board.length} rows`;
  for (let i = 0; i < board.length; i++) if (board[i]!.rank !== i + 1) return `rank ${i + 1} is ${board[i]!.rank}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i}`;
  if (board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'all implied values are identical';
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) return `${r.slug}: bad implied value`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug}: ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug}: a farm step of ${s.length} chars`;
  }
  return null;
}

/** Parse and validate the sealed snapshot. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new SnapshotError('snapshot.json is not JSON'); }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not an object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`protocol ${i} lacks a slug, name or TVL`);
    }
    return {
      slug: p.slug, name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' && p.gecko_id !== '-' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' && p.symbol !== '-' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** The whole dataset as one script the page reads with no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
