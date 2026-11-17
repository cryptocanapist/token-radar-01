// Token Radar, model radar-2: a comps-fitted valuation, scored from the snapshot alone.
//
// The board ranks pre-token protocols — protocols that record no token (no market cap, no
// CoinGecko id, no symbol). Live-token protocols are never ranked; they are the comparables the
// value model is fitted on, and the dashboard shows them apart with their market caps.
//
// How a row is scored, in order:
//   1. Fitted base. On the live-token comparables (positive market cap, exchanges excluded),
//      fit log(market cap) = a + b * log(TVL) by least squares, then add a per-category
//      adjustment: the median log residual of that category, shrunk by n/(n+5), kept only when
//      the category has at least 3 comparables, and capped at +/-0.5 log units. Categories with
//      too few comparables get no adjustment. The fit is recomputed from the snapshot on every
//      run, so the numbers the dashboard states are the numbers the code actually used.
//   2. Growth. The 7-day TVL change, clamped to -60%..+120%, at half weight: a week's move is
//      momentum, not value, and must not dominate the score.
//   3. Maturity. 0.6 + min(age, 1095)/1095 * 0.4, age from listed_at, 365 days when unlisted:
//      a protocol that has run for years with no token is more likely to launch than a new one.
//   4. Chain breadth. +2.5% per extra chain, up to +5%: diversification, worth a little.
//   implied = max(1, round(exp(a + b*ln(TVL) + categoryAdj) * growthMult * maturityMult * chainMult))
//
// The flat 0.25x-TVl starter is kept only as the baseline the fit is tested against: leave-one-out
// and a pre-2025/post-2025 time split, both reported as median absolute log error on the
// comparables. The fitted model ships because it beats the flat baseline on both tests (see the
// fit record the run prints and the dashboard's methodology section). No protocol name is ever
// special-cased: one function scores every row.

/** One protocol entry, exactly the ten fields the sealed snapshot carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The constants that are not fitted: growth, maturity and chain-breadth weights. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_max: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_step: 0.025,
  chain_max: 0.05,
};

/** The model version the dashboard names. */
export const MODEL_VERSION = 'radar-2';

/** Pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** Live-token protocols the dashboard's live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** Minimum comparables for a category to earn its own adjustment; fewer fall back to zero. */
export const CATEGORY_MIN_N = 3;

/** Shrinkage denominator for a category adjustment: weight n/(n + CATEGORY_SHRINK_K). */
export const CATEGORY_SHRINK_K = 5;

/** Largest absolute category adjustment, in log units. */
export const CATEGORY_ADJ_CAP = 0.5;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    effective_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    category_adjustment: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A board row in the compact form data.js carries; the page rebuilds the farm plan from it. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  category_adjustment: number;
  effective_multiple: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** The fitted valuation, as the dashboard states it. */
export interface FitRecord {
  comps_n: number;
  intercept: number;
  slope: number;
  global_median_ratio: number;
  category_adjustments: Record<string, number>;
  category_counts: Record<string, number>;
  loo_median_abs_log_error: number;
  loo_baseline_median_abs_log_error: number;
  time_split_train_n: number;
  time_split_test_n: number;
  time_split_median_abs_log_error: number | null;
  time_split_baseline_median_abs_log_error: number | null;
}

/** Everything the dashboard needs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  fit: FitRecord;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why a snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list, or 0 for an empty one. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** A protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** A version marker at the end of a name: a release pool of another protocol, not a launch of its own. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The comparables the value model is fitted on: live-token, positive market cap, no exchanges.
 *  Exchange tokens are a different business (a venue's own token), not a protocol launch, so they
 *  would bend the fit if left in. Dead tokens (market cap zero or negative) carry no signal. */
export function comparables(protocols: SnapshotProtocol[]): SnapshotProtocol[] {
  return protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.category !== 'CEX');
}

/** Least squares for log(mcap) = a + b * log(TVL) on a set of comparables. */
function olsFit(rows: SnapshotProtocol[]): { intercept: number; slope: number } {
  const n = rows.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const p of rows) {
    const x = Math.log(p.tvl_usd);
    const y = Math.log(p.mcap_usd!);
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const denom = n * sxx - sx * sx;
  const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return { intercept, slope };
}

/** Per-category log-residual adjustments for a fitted line: median residual, shrunk by
 *  n/(n+5), kept only for categories with at least 3 comparables, capped at +/-0.5 log units. */
function categoryAdjustments(rows: SnapshotProtocol[], fit: { intercept: number; slope: number }): Record<string, number> {
  const byCategory = new Map<string, number[]>();
  for (const p of rows) {
    const residual = Math.log(p.mcap_usd!) - (fit.intercept + fit.slope * Math.log(p.tvl_usd));
    const key = p.category ?? 'Other';
    const list = byCategory.get(key) ?? [];
    list.push(residual);
    byCategory.set(key, list);
  }
  const out: Record<string, number> = {};
  for (const [key, residuals] of byCategory) {
    if (residuals.length < CATEGORY_MIN_N) continue;
    const weight = residuals.length / (residuals.length + CATEGORY_SHRINK_K);
    const shrunk = weight * median(residuals);
    out[key] = Math.max(-CATEGORY_ADJ_CAP, Math.min(CATEGORY_ADJ_CAP, shrunk));
  }
  return out;
}

/** The fitted base value (before growth, maturity and chain terms) for one protocol. */
function fittedBase(p: SnapshotProtocol, fit: { intercept: number; slope: number }, adjustments: Record<string, number>): number {
  const adj = adjustments[p.category ?? 'Other'] ?? 0;
  return Math.exp(fit.intercept + fit.slope * Math.log(p.tvl_usd) + adj);
}

/** Median absolute log error of a base-value predictor over a set of comparables. */
function medianAbsLogError(rows: SnapshotProtocol[], predict: (p: SnapshotProtocol) => number): number {
  const errors = rows.map((p) => Math.abs(Math.log(predict(p)) - Math.log(p.mcap_usd!)));
  return median(errors);
}

/** Fit the valuation on the snapshot's comparables and test it out of sample.
 *  Leave-one-out refits the line and the category adjustments on every other comparable, so each
 *  prediction is made by a model that never saw the protocol it scores. The time split trains on
 *  protocols listed before 2025-01-01 and tests on those listed after. Both are reported against
 *  the flat 0.25x TVL baseline, using the base value only (growth, maturity and chain breadth are
 *  scoring terms for pre-token rows, not part of predicting a live token's market cap). */
function valuationParts(protocols: SnapshotProtocol[]): {
  comps: SnapshotProtocol[];
  raw: { intercept: number; slope: number };
  adjustments: Record<string, number>;
  record: FitRecord;
} {
  const comps = comparables(protocols);
  const raw = olsFit(comps);
  const adjustments = categoryAdjustments(comps, raw);
  const globalMedianRatio = median(comps.map((p) => p.mcap_usd! / p.tvl_usd));
  const counts: Record<string, number> = {};
  for (const p of comps) {
    const key = p.category ?? 'Other';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const baseline = (p: SnapshotProtocol): number => 0.25 * p.tvl_usd;

  let looError = 0;
  let looBaseline = 0;
  if (comps.length > 1) {
    const looErrors: number[] = [];
    const looBaseErrors: number[] = [];
    for (let i = 0; i < comps.length; i++) {
      const train = comps.filter((_, j) => j !== i);
      const trainFit = olsFit(train);
      const trainAdj = categoryAdjustments(train, trainFit);
      const held = comps[i]!;
      looErrors.push(Math.abs(Math.log(fittedBase(held, trainFit, trainAdj)) - Math.log(held.mcap_usd!)));
      looBaseErrors.push(Math.abs(Math.log(baseline(held)) - Math.log(held.mcap_usd!)));
    }
    looError = median(looErrors);
    looBaseline = median(looBaseErrors);
  }

  const dated = comps.filter((p) => p.listed_at !== null);
  const train = dated.filter((p) => p.listed_at! < '2025-01-01');
  const test = dated.filter((p) => p.listed_at! >= '2025-01-01');
  let timeError: number | null = null;
  let timeBaseline: number | null = null;
  if (train.length >= 10 && test.length >= 5) {
    const trainFit = olsFit(train);
    const trainAdj = categoryAdjustments(train, trainFit);
    timeError = medianAbsLogError(test, (p) => fittedBase(p, trainFit, trainAdj));
    timeBaseline = medianAbsLogError(test, baseline);
  }

  const record: FitRecord = {
    comps_n: comps.length,
    // Intercept, slope and the global median ratio are kept at full precision: the dashboard
    // recomputes rows from them, so rounding here would make its check disagree with the board.
    intercept: raw.intercept,
    slope: raw.slope,
    global_median_ratio: globalMedianRatio,
    category_adjustments: adjustments,
    category_counts: counts,
    loo_median_abs_log_error: Math.round(looError * 1000) / 1000,
    loo_baseline_median_abs_log_error: Math.round(looBaseline * 1000) / 1000,
    time_split_train_n: train.length,
    time_split_test_n: test.length,
    time_split_median_abs_log_error: timeError === null ? null : Math.round(timeError * 1000) / 1000,
    time_split_baseline_median_abs_log_error: timeBaseline === null ? null : Math.round(timeBaseline * 1000) / 1000,
  };
  return { comps, raw, adjustments, record };
}

/** The fitted valuation record for a snapshot's protocols. */
export function fitValuation(protocols: SnapshotProtocol[]): FitRecord {
  return valuationParts(protocols).record;
}

/** The growth, maturity and chain multipliers and the implied value one protocol gets. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  fit: { intercept: number; slope: number },
  adjustments: Record<string, number>,
): { implied: number; base: number; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; categoryAdj: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const extraChains = Math.max(0, Math.min(protocol.chains.length - 1, 2));
  const chainMult = 1 + Math.min(model.chain_max, extraChains * model.chain_step);
  const categoryAdj = adjustments[protocol.category ?? 'Other'] ?? 0;
  const base = fittedBase(protocol, fit, adjustments);
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * chainMult));
  return { implied, base, growthPct, growthMult, maturityMult, chainMult, categoryAdj, age };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n — plus the fit that scored them. */
export function buildBoardWithFit(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; fit: FitRecord } {
  const { raw, adjustments, record } = valuationParts(snapshot.protocols);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model, raw, adjustments);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      effective_multiple: round4(s.base / s.p.tvl_usd),
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      chain_multiplier: round4(s.chainMult),
      // Category adjustment is kept at full precision: the dashboard recomputes rows from it,
      // so rounding here would make its check disagree with the board by a few dollars.
      category_adjustment: s.categoryAdj,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age, s.implied).map(stepText),
  }));
  return { board, fit: record };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  return buildBoardWithFit(snapshot, model).board;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** One farm step as a single string: action, cost, time — within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL tier. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time, derived from the
 * protocol's own record (category, chains, TVL tier, age) and its implied value — never from a
 * hand-written list of names. The last two steps net the cost at the low end and say plainly
 * when the row is thin: a small implied value next to the farming cost means skip it unless you
 * already use the protocol. No yield, APY or airdrop is promised anywhere — the snapshot
 * carries none.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, implied: number): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const weeks = Math.max(1, Math.ceil(hold / 7));
  const gasLow = 3 + 2 * weeks;
  const action = actionFor(p, capital, chain);
  const thin = implied < 3_000_000;
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
    {
      text: `Net cost at the low end: about $${gasLow} of gas over the ${hold}-day hold (${weeks} weekly actions), plus the $${capital} of capital that stays in the position and can be withdrawn.`,
      cost: `about $${gasLow} of gas, capital recoverable`,
      time: `${hold} days in total`,
    },
    {
      text: thin
        ? `Thin row: the implied value is small next to the $${gasLow} of gas above, so skip this farm unless you already use the protocol.`
        : `The implied value is large enough that the $${gasLow} of gas above is small next to it — still no promise of a payout.`,
      cost: thin ? 'saving the gas by skipping' : 'about $0 extra',
      time: 'no extra time',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    category_adjustment: row.model.category_adjustment,
    effective_multiple: row.model.effective_multiple,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, fit } = buildBoardWithFit(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    fit,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
