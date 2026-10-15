// Browser-only edition: the Guided demo told as one season. Five chapters follow the pitch's
// flow slide (historical rainfall, predefined policy, collateral reserved, rainfall finalized,
// payout or release) and show each result in place; a closing view plays the whole process on
// one screen. The chain steps replay the same recording as the numbered step list, which stays
// below under "Step-by-step controls and receipts"; the pricing chapter runs the model here.
const control = window.cropguardStatic;
const page = document.getElementById('page-operations');
const workspace = document.getElementById('demo-workspace');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const SVG_NS = 'http://www.w3.org/2000/svg';
const $ = id => document.getElementById(id);

// The recorded actions, in order, with the button labels the pitch script cues.
const STEPS = [
  ['fund', 'Fund demonstration pool'],
  ['advance:funding-close', 'Move to funding cutoff'],
  ['open-sales', 'Open policy sales'],
  ['purchase', 'Buy two-hectare cover'],
  ['advance:report', 'Move to reporting date'],
  ['report', 'Report archived ERA5 rainfall'],
  ['advance:challenge-end', 'Pass the review period'],
  ['finalize', 'Finalize rainfall'],
  ['settle-pay', 'Settle and pay policy'],
];
const CHAPTERS = [
  {name: 'Historical rainfall', rail: 'Historical rainfall'},
  {name: 'Predefined policy', rail: 'Predefined policy'},
  {name: 'Collateral reserved', rail: 'Collateral reserved', first: 0, last: 3},
  {name: 'Rainfall finalized', rail: 'Rainfall finalized', first: 4, last: 7},
  {name: 'Payout or release', rail: 'Payout or release', first: 8, last: 8},
  {name: 'The whole process in one', rail: 'All in one'},
];
// The Pricing lab's defaults, which reproduce the team's R script.
const PRICING_REQUEST = {
  history_start_year: 1985, training_cutoff_year: 2025, first_month: 6, month_count: 4,
  threshold_mm: '297.289', threshold_mode: 'gamma_p10', maximum_usdc: '150', hectares: 100,
  period_capital_bps: 1000, operating_fee_usdc: '1', oracle_failure_allowance_usdc: '0.50',
  simulations: 10000, method: 'gamma', seed: 42, rainfall_change_bps: 0,
};
const PREMIUM_PARTS = [
  ['expectedLossPerHaBaseUnits', 'Expected claim'],
  ['capitalCostPerHaBaseUnits', 'Capital charge'],
  ['operatingFeePerHaBaseUnits', 'Operations'],
  ['oracleFailureAllowancePerHaBaseUnits', 'Oracle failure allowance'],
];

const state = {chapter: 0, snap: null, busy: false, error: ''};
const pricing = {status: 'idle', result: null, error: ''};
const player = {running: false, paused: false, token: 0, slow: false, active: null, caption: '', finished: false};
let ctx, view, syncing = false;

class Cancelled extends Error {}

if (control?.seek && page && workspace) {
  const begin = () => setTimeout(() => void start().catch(error => console.error('Season story unavailable:', error)), 0);
  if (window.cropguardStatus) begin(); else window.addEventListener('cropguard:status', begin, {once: true});
}

// ---- Formatting ---------------------------------------------------------------
const numberFormats = new Map();
function fmt(value, digits = 3) {
  if (!numberFormats.has(digits)) numberFormats.set(digits, new Intl.NumberFormat('en', {maximumFractionDigits: digits}));
  return numberFormats.get(digits).format(value);
}
/** Base units (six decimals) to cents, rounded half up as the site's money() does. */
function cents(baseUnits) {
  const value = (BigInt(baseUnits) + 5000n) / 10000n;
  return (Number(value) / 100).toFixed(2);
}
const dayFormat = new Intl.DateTimeFormat('en-GB', {day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'});
const monthFormat = new Intl.DateTimeFormat('en-US', {month: 'short', timeZone: 'UTC'});
const day = seconds => dayFormat.format(new Date(seconds * 1000));
const tokens = value => Number(value ?? 0) / 1e6;
const escape = text => String(text).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const range = (a, b) => Array.from({length: b - a + 1}, (_, i) => a + i);
const count = n => ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n] ?? fmt(n);
const initial = text => text[0].toUpperCase() + text.slice(1);

// ---- Recorded state -------------------------------------------------------------
function snapshot(at) {
  const status = control.recorded('/api/demo/status', at) ?? {};
  const pool = control.recorded('/api/pool', at) ?? {};
  const policy = (control.recorded(`/api/policies/${ctx.farmer}?after=0`, at)?.items ?? [])[0];
  const observation = control.recorded(`/api/observation/${ctx.manifest.observationKey}`, at)?.result ?? {};
  const policyState = policy ? Number(policy.state) : 0;
  return {
    step: at, time: Number(status.timestamp ?? 0),
    capital: tokens(pool.capitalAssets), locked: tokens(pool.lockedCollateral),
    premiums: tokens(pool.unearnedPremiums), fees: tokens(pool.accruedFees),
    salesOpen: Boolean(status.salesEnabled),
    policy: policy ? {state: policyState, units: Number(policy.units), premium: tokens(policy.premium), maximum: tokens(policy.maximum)} : null,
    paid: policyState === 3 ? tokens(policy.claim) : 0,
    observation: Number(observation.state ?? status.observationState ?? 0),
    rainfall: Number(observation.rainfallMmX1000 ?? 0) / 1000,
    proposedAt: Number(observation.proposedAt ?? 0), challengeEnds: Number(observation.challengeEndsAt ?? 0),
    evidenceUrl: status.evidenceUrl || null,
  };
}

async function loadSeasons(year) {
  const response = await fetch('data/model-inputs.json');
  if (!response.ok) throw new Error(`Rainfall history unavailable (HTTP ${response.status}).`);
  const inputs = await response.json();
  const byYear = new Map();
  for (const record of inputs.datasets.bundled_era5.records) {
    const [y, m] = record.month.split('-').map(Number);
    if (m < PRICING_REQUEST.first_month || m >= PRICING_REQUEST.first_month + PRICING_REQUEST.month_count) continue;
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push({month: m, mm: Number(record.rainfallMmX1000) / 1000});
  }
  const seasons = [...byYear].filter(([y, months]) => y >= PRICING_REQUEST.history_start_year && y <= PRICING_REQUEST.training_cutoff_year && months.length === PRICING_REQUEST.month_count)
    .map(([y, months]) => ({year: y, mm: Math.round(months.reduce((sum, m) => sum + m.mm, 0) * 1000) / 1000}))
    .sort((a, b) => a.year - b.year);
  const months = (byYear.get(year) ?? []).sort((a, b) => a.month - b.month);
  return {seasons, months};
}

async function start() {
  const status = window.cropguardStatus;
  if (status?.mode !== 'hosted_demo' && status?.hostedDemo !== true) return;
  const data = await control.replay;
  const steps = control.steps();
  const keys = steps.map(s => s.action + (s.params?.phase ? `:${s.params.phase}` : ''));
  if (keys.join() !== STEPS.map(([key]) => key).join()) return; // Another recording: keep the numbered list only.
  const m = status.manifest, terms = m.localTerms ?? {}, replay = m.historicalReplay ?? {};
  ctx = {
    runId: data.runId, recordedOn: data.recordedOn, manifest: m, steps,
    farmer: m.demoAccounts.find(a => a.role === 'farmer')?.address,
    providers: ['investor-a', 'investor-b', 'investor-c'].map((role, i) => {
      const label = m.demoAccounts.find(a => a.role === role)?.label ?? '';
      return {name: `Provider ${'ABC'[i]}`, amount: Number(/\(([\d,]+)\)/.exec(label)?.[1].replaceAll(',', '') ?? 0)};
    }),
    trigger: Number(terms.thresholdMmX1000) / 1000,
    premiumExact: Number(terms.premiumPerUnit) / 1e6, premiumCents: cents(terms.premiumPerUnit),
    maxPerHa: Number(terms.maximumPerUnit) / 1e6, maxHectares: Number(terms.maximumHectares ?? 100),
    year: Number(replay.sourceYear ?? 2023),
  };
  ctx.triggerShort = ctx.trigger.toFixed(2);
  const last = snapshot(steps.length), funded = snapshot(1), bought = snapshot(4);
  ctx.units = last.policy?.units ?? 2;
  ctx.maxPayout = ctx.units * ctx.maxPerHa;
  ctx.final = last;
  ctx.reserved = bought;
  ctx.ledger = {start: funded.capital, premium: bought.policy?.premium ?? 0, fee: last.fees, payout: last.paid, end: last.capital};
  ctx.ledger.balances = Math.abs(ctx.ledger.start + ctx.ledger.premium - ctx.ledger.fee - ctx.ledger.payout - ctx.ledger.end) < 1e-6;
  const t0 = snapshot(0).time, review = Number(m.reportNotBefore) + Number(m.challengePeriod);
  ctx.timeline = {
    points: [t0, Number(m.fundingClose), Number(m.coverageStart), Number(m.coverageEnd), Number(m.reportNotBefore), review],
    weights: [2, 0.9, 2.4, 2, 1.4],
    labels: ['Funding', 'Sales', `Cover · ${monthFormat.format(new Date(m.coverageStart * 1000))}–${monthFormat.format(new Date((m.coverageEnd - 1) * 1000))} ${new Date(m.coverageStart * 1000).getUTCFullYear()}`,
      `${Math.round((m.reportNotBefore - m.coverageEnd) / 86400)}-day publication lag`, `${count(Math.round(m.challengePeriod / 86400))}-day review`],
    coverYear: new Date(m.coverageStart * 1000).getUTCFullYear(),
  };
  ctx.lagDays = Math.round((m.reportNotBefore - m.coverageEnd) / 86400);
  ctx.reviewDays = Math.round(m.challengePeriod / 86400);
  try { Object.assign(ctx, await loadSeasons(ctx.year)); } catch { ctx.seasons = []; ctx.months = []; }
  if (ctx.seasons.length) {
    ctx.mean = ctx.seasons.reduce((sum, s) => sum + s.mm, 0) / ctx.seasons.length;
    ctx.driest = ctx.seasons.reduce((a, b) => b.mm < a.mm ? b : a);
  }
  build();
}

// ---- Page structure --------------------------------------------------------------
function build() {
  const section = document.createElement('section');
  section.id = 'season-story';
  section.setAttribute('aria-labelledby', 'story-title');
  section.innerHTML = `
<div class="story-head"><div><span class="eyebrow muted">RECORDED REPLAY · VALUELESS TEST TOKENS · NOT INSURANCE</span>
<h2 id="story-title">A season, from rainfall to payment</h2>
<p class="story-sub">Each chain step replays a real run on a private test blockchain, recorded on ${escape(ctx.recordedOn)}. The pricing model runs in your browser.</p></div>
<div class="story-head-actions"><button class="button outline small-button" id="story-present" type="button" aria-pressed="false">Present</button>
<button class="button outline small-button" id="story-restart" type="button">Restart</button></div></div>
<ol class="story-rail" id="story-rail">${CHAPTERS.map((c, i) => `<li><button type="button" data-chapter="${i}"><b>${i + 1}</b><span>${c.rail}</span></button></li>`).join('')}</ol>
<div class="story-body"><div class="story-stage panel" id="story-stage"></div>
<aside class="story-ledger" id="story-ledger" aria-label="The season so far">${ledgerHtml()}</aside></div>
<div class="story-bottom"><p class="story-caption" id="story-caption" role="status" aria-live="polite"></p>
<div class="story-controls"><button class="button outline" id="story-back" type="button"><span aria-hidden="true">←</span> Back</button>
<button class="button primary" id="story-next" type="button"></button></div></div>`;
  const toggle = document.createElement('button');
  toggle.id = 'story-technical';
  toggle.type = 'button';
  toggle.className = 'story-technical';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'demo-workspace');
  toggle.innerHTML = '<span>Step-by-step controls and receipts</span><small>The nine recorded steps as separate buttons, with their receipts and the contract state</small><b aria-hidden="true">+</b>';
  workspace.before(section, toggle);
  workspace.classList.add('story-collapsed');
  document.documentElement.classList.add('story-ready');

  toggle.addEventListener('click', () => {
    const open = workspace.classList.toggle('story-collapsed') === false;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.querySelector('b').textContent = open ? '−' : '+';
  });
  $('story-rail').addEventListener('click', event => {
    const button = event.target.closest('button[data-chapter]');
    if (button) jump(Number(button.dataset.chapter));
  });
  $('story-next').addEventListener('click', () => void next());
  $('story-back').addEventListener('click', back);
  $('story-restart').addEventListener('click', restart);
  $('story-present').addEventListener('click', () => present(!document.documentElement.classList.contains('story-present')));
  document.addEventListener('keydown', keys);
  // The numbered list and the other pages read the same replay; follow their changes.
  window.addEventListener('cropguard:refresh', () => { if (!syncing) sync(); });
  window.addEventListener('cropguard:navigate', event => {
    if (event.detail.page === 'operations') { sync(); warmSoon(); } else { stopPlayer(); present(false); }
  });
  addHeroButton();

  state.snap = snapshot(control.currentStep());
  setChapter(chapterForStep(state.snap.step));
  if (!page.classList.contains('hidden')) warmSoon();
}

function addHeroButton() {
  const primary = document.querySelector('#page-overview .hero-bottom .button');
  if (!primary) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button outline';
  button.innerHTML = 'Watch a season, rainfall to payment <span aria-hidden="true">↗</span>';
  button.addEventListener('click', () => document.querySelector('.nav[data-page="operations"]')?.click());
  primary.after(button);
}

let warmTimer;
function warmSoon() {
  clearTimeout(warmTimer);
  warmTimer = setTimeout(() => void control.warmModel().catch(() => {}), 800);
}

function chapterForStep(step) {
  if (step === 0) return 0;
  if (step <= 4) return 2;
  if (step <= 8) return 3;
  return 4;
}

// ---- Navigation ------------------------------------------------------------------
function setChapter(index) {
  state.chapter = index;
  state.error = '';
  const stage = $('story-stage');
  stage.replaceChildren();
  stage.dataset.chapter = String(index);
  view = [rainfallView, pricingView, collateralView, settlementRainView, payoutView, wholeView][index](stage);
  view.update(state.snap, null, false);
  updateLedger(null, state.snap, false);
  chrome();
}

function applySnap(next, animate) {
  const previous = state.snap;
  state.snap = next;
  updateLedger(previous, next, animate);
  view?.update(next, previous, animate);
  chrome();
}

function notifyOthers() {
  syncing = true;
  try { window.dispatchEvent(new CustomEvent('cropguard:refresh')); } finally { syncing = false; }
  $('ops-refresh')?.click(); // The numbered list's own refresh, so its ticks match.
}

function sync() {
  if (!ctx || player.running || state.busy) return;
  const step = control.currentStep();
  if (step === state.snap.step) return;
  const chapter = CHAPTERS[state.chapter];
  applySnap(snapshot(step), true);
  if (chapter.first === undefined || step < chapter.first || step > chapter.last + 1) setChapter(chapterForStep(step));
}

function seekTo(step) {
  control.seek(step);
  applySnap(snapshot(step), false);
  notifyOthers();
}

function jump(index) {
  stopPlayer();
  const target = CHAPTERS[index], step = state.snap.step;
  if (target.first !== undefined && (step < target.first || step > target.last + 1)) {
    control.seek(target.first);
    state.snap = snapshot(target.first);
    notifyOthers();
  }
  setChapter(index);
}

async function next() {
  if (state.busy || player.running) return;
  const index = state.chapter, chapter = CHAPTERS[index], step = state.snap.step;
  if (index === 1 && ['idle', 'running'].includes(pricing.status)) { if (pricing.status === 'idle') await runPricing(); return; }
  if (chapter.first !== undefined && step >= chapter.first && step <= chapter.last) { await performStep(step); return; }
  if (index < CHAPTERS.length - 1) jump(index + 1);
}

function back() {
  if (state.busy || player.running) return;
  const chapter = CHAPTERS[state.chapter], step = state.snap.step;
  if (chapter.first !== undefined && step > chapter.first && step <= chapter.last + 1) { seekTo(step - 1); return; }
  if (state.chapter > 0) setChapter(state.chapter - 1);
}

function restart() {
  stopPlayer();
  player.finished = false;
  control.seek(0);
  state.snap = snapshot(0);
  notifyOthers();
  setChapter(0);
}

function keys(event) {
  if (page.classList.contains('hidden') || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === 'Escape' && document.documentElement.classList.contains('story-present')) { present(false); return; }
  if (event.target.closest?.('input,textarea,select,[contenteditable],dialog') || document.querySelector('dialog[open]')) return;
  // Presentation clickers send PageDown and PageUp; outside presentation mode those keys keep scrolling the page.
  const onPage = event.target === document.body || event.target === document.documentElement;
  const presenting = document.documentElement.classList.contains('story-present');
  if (event.key === 'ArrowRight' || (event.key === 'PageDown' && presenting) || (event.key === ' ' && onPage)) { event.preventDefault(); void next(); }
  else if (event.key === 'ArrowLeft' || (event.key === 'PageUp' && presenting)) { event.preventDefault(); back(); }
}

function present(on) {
  const root = document.documentElement;
  if (root.classList.contains('story-present') === on) return;
  root.classList.toggle('story-present', on);
  const button = $('story-present');
  if (button) { button.textContent = on ? 'Exit presentation' : 'Present'; button.setAttribute('aria-pressed', String(on)); }
  if (on) window.scrollTo({top: 0, behavior: 'instant'});
}

// ---- Actions -----------------------------------------------------------------------
async function performStep(index) {
  state.busy = true;
  state.error = '';
  chrome();
  try {
    const {action, params} = ctx.steps[index];
    const response = await fetch('/api/demo/actions', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-CropGuard-Run': ctx.runId, 'Idempotency-Key': `story-${ctx.runId}-${index}-${Date.now()}`},
      body: JSON.stringify({action, params}),
    });
    let body = {};
    try { body = await response.json(); } catch { /* Reported below. */ }
    if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : body.detail?.message ?? 'The recorded step could not be replayed.');
    applySnap(snapshot(control.currentStep()), true);
    notifyOthers();
    return true;
  } catch (error) {
    state.error = error.message;
    return false;
  } finally {
    state.busy = false;
    chrome();
  }
}

async function runPricing() {
  if (pricing.status === 'running') return;
  pricing.status = 'running';
  pricing.error = '';
  pricingChanged();
  try {
    await control.warmModel();
    const snapshotId = (control.recorded('/api/weather/datasets')?.items ?? []).find(d => d.station === 'ET_TEAM_BOX')?.snapshot_id;
    const request = {...PRICING_REQUEST, ...(snapshotId ? {source: 'ethiopia_archive', snapshot_id: snapshotId} : {source: 'bundled_era5'})};
    const response = await fetch('/api/simulation/run', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(request)});
    const result = await response.json();
    if (!response.ok || !result.pricing) throw new Error(typeof result.detail === 'string' ? result.detail : 'The model returned no price.');
    pricing.result = result;
    pricing.status = 'done';
  } catch (error) {
    pricing.status = 'error';
    pricing.error = error.message || 'The model could not run.';
  }
  pricingChanged();
}

function pricingChanged() {
  view?.pricingChanged?.();
  chrome();
}

// ---- Playing the whole season -------------------------------------------------------
async function play() {
  if (player.running) { player.paused = !player.paused; chrome(); return; }
  const token = ++player.token;
  Object.assign(player, {running: true, paused: false, active: null, finished: false, caption: ''});
  if (state.chapter !== 5) setChapter(5);
  if (pricing.status === 'idle') void runPricing();
  const unit = player.slow ? 2 : 1;
  try {
    control.seek(0);
    state.snap = snapshot(0);
    notifyOthers();
    applySnap(state.snap, false);
    await phase(token, 0, playCaption(0), 2600 * unit);
    await phase(token, 1, playCaption(1), 3000 * unit);
    for (let i = 0; i < STEPS.length; i++) {
      await hold(token, 0);
      setActive(i <= 3 ? 2 : i <= 7 ? 3 : 4);
      player.caption = `${i + 1}. ${STEPS[i][1]}…`;
      chrome();
      if (!await performStep(i)) throw new Error(state.error);
      if (token !== player.token) throw new Cancelled();
      player.caption = stepCaption(i);
      chrome();
      await hold(token, (i === STEPS.length - 1 ? 3400 : 2600) * unit);
    }
    player.active = null;
    player.finished = true;
    player.caption = '';
    view.update(state.snap, null, false);
  } catch (error) {
    if (!(error instanceof Cancelled)) state.error = error.message;
  } finally {
    if (token === player.token) { player.running = false; player.paused = false; player.active = null; view?.update(state.snap, null, false); chrome(); }
  }
}

async function phase(token, card, caption, ms) {
  await hold(token, 0);
  setActive(card);
  player.caption = caption;
  chrome();
  await hold(token, ms);
}

async function hold(token, ms) {
  let left = ms;
  while (left > 0 || player.paused) {
    if (token !== player.token) throw new Cancelled();
    await new Promise(resolve => setTimeout(resolve, 100));
    if (!player.paused) left -= 100;
  }
  if (token !== player.token) throw new Cancelled();
}

function setActive(card) {
  const previous = player.active;
  player.active = card;
  view?.update(state.snap, null, false);
  if (previous !== null && card > previous) view?.runLink?.(card - 1);
}

function stopPlayer() {
  if (!player.running) return;
  player.token++;
  Object.assign(player, {running: false, paused: false, active: null, caption: ''});
}

// ---- Words ---------------------------------------------------------------------------
function stepCaption(i) {
  const m = ctx.manifest, p = ctx.providers, s = snapshot(i + 1);
  const total = p.reduce((sum, v) => sum + v.amount, 0);
  return [
    `Three capital providers fund the pool: ${p.map(v => fmt(v.amount)).join(' + ')} = ${fmt(total)} test tokens, the full payout for ${fmt(ctx.maxHectares)} hectares at ${fmt(ctx.maxPerHa)} each.`,
    `The test-chain clock moves to the funding cutoff, ${day(m.fundingClose)}. The pool holds the ${fmt(s.capital)} it needs.`,
    `Policy sales open on fixed terms: ${fmt(ctx.maxPerHa)} per hectare if June–September rainfall is below ${ctx.triggerShort} mm, for a premium of ${fmt(ctx.premiumExact, 6)} per hectare.`,
    `The farmer buys ${count(ctx.units)} hectares for ${fmt(s.policy?.premium ?? 0)} test tokens. In the same transaction the pool locks the full ${fmt(ctx.maxPayout)}-token maximum payout.`,
    `The cover ran from June to September ${ctx.timeline.coverYear}. After the ${ctx.lagDays}-day publication lag, reporting opens on ${day(m.reportNotBefore)}.`,
    `A local test oracle reports the replayed June–September ${ctx.year} rainfall: ${fmt(s.rainfall)} mm. A ${count(ctx.reviewDays)}-day review period starts.`,
    `${initial(count(ctx.reviewDays))} days pass and nobody challenges the report.`,
    `The rainfall result is final: ${fmt(s.rainfall)} mm, below the ${ctx.triggerShort} mm trigger.`,
    `Settlement pays the fixed ${fmt(s.paid)} test tokens to the farmer. Nobody has to assess the farm.`,
  ][i];
}

function playCaption(card) {
  const n = ctx.seasons.length;
  if (card === 0) return n ? `${n} seasons of June–September rainfall, ${ctx.seasons[0].year}–${ctx.seasons.at(-1).year}, from the ERA5-Land reanalysis.` : 'The rainfall history comes from the ERA5-Land reanalysis.';
  return `A Gamma fit sets the trigger at ${ctx.triggerShort} mm, and 10,000 simulated seasons price the cover at ${premiumText()} per hectare.`;
}

function premiumText() {
  return pricing.result ? cents(pricing.result.pricing.premiumPerHaBaseUnits) : ctx.premiumCents;
}

function summaryCaption() {
  const f = ctx.final;
  return `The whole season: ${ctx.seasons.length} seasons of rainfall → a ${ctx.triggerShort} mm trigger and ${premiumText()} per hectare → ${fmt(ctx.ledger.start)} reserved → ${fmt(f.rainfall)} mm, final → ${fmt(f.paid)} paid to the farmer.`;
}

function caption() {
  if (state.error) return state.error;
  const c = state.chapter, snap = state.snap, chapter = CHAPTERS[c];
  if (c === 0) return ctx.seasons.length ? `Each bar is one season's June–September rainfall over the index area. The policy is priced on these ${ctx.seasons.length} seasons.` : 'The rainfall history could not be loaded on this page.';
  if (c === 1) {
    if (pricing.status === 'running') return 'Running 10,000 simulated seasons in your browser…';
    if (pricing.status === 'error') return `The pricing model could not run here (${pricing.error}). The recorded policy terms are shown instead.`;
    if (pricing.status === 'done') {
      const p = pricing.result.pricing;
      const sum = PREMIUM_PARTS.map(([key, name]) => `${name.toLowerCase()} ${cents(p[key])}`).join(' + ');
      return `${sum[0].toUpperCase()}${sum.slice(1)} = ${cents(p.premiumPerHaBaseUnits)} per hectare.`;
    }
    return 'The trigger and the price come from a model fitted to these seasons. It runs here, in your browser.';
  }
  if (c === 5) {
    if (player.running) return player.paused ? `Paused. ${player.caption}` : player.caption;
    return snap.step === STEPS.length ? summaryCaption() : `Play runs the whole season on this one screen, from the rainfall record to the payment, in about ${player.slow ? 'a minute' : '35 seconds'}.`;
  }
  const done = snap.step - 1;
  if (done >= chapter.first && done <= chapter.last) return stepCaption(done);
  return [, , `Before any cover is sold, the pool must hold the full maximum payout for the ${fmt(ctx.maxHectares)} hectares on offer.`,
    `The cover runs from June to September on the test chain. The rainfall it will receive is the real ${ctx.year} season from the team's series.`,
    'The rainfall is final. Settlement now either pays the policy or releases its capital.'][c];
}

function nextLabel() {
  const c = state.chapter, chapter = CHAPTERS[c], step = state.snap.step;
  if (c === 1 && pricing.status === 'idle') return 'Run the pricing model';
  if (c === 1 && pricing.status === 'running') return 'Running the model…';
  if (chapter.first !== undefined && step >= chapter.first && step <= chapter.last) return `${step + 1}. ${STEPS[step][1]}`;
  return c < CHAPTERS.length - 1 ? `Next: ${CHAPTERS[c + 1].name}` : '';
}

function chrome() {
  if (!ctx) return;
  const step = state.snap.step, c = state.chapter, locked = state.busy || player.running;
  $('story-rail').querySelectorAll('li').forEach((li, i) => {
    const chapter = CHAPTERS[i];
    const done = i === 0 ? c > 0 || step > 0 : i === 1 ? pricing.status === 'done' || step > 0
      : chapter.first !== undefined ? step > chapter.last : false;
    li.className = i === c ? 'current' : done ? 'done' : '';
    li.querySelector('button').setAttribute('aria-current', i === c ? 'step' : 'false');
  });
  const label = nextLabel(), nextButton = $('story-next');
  nextButton.hidden = !label;
  nextButton.innerHTML = `<span>${escape(label)}</span><span aria-hidden="true">→</span>`;
  nextButton.disabled = locked || pricing.status === 'running' && c === 1;
  $('story-back').disabled = locked || (c === 0);
  $('story-restart').disabled = state.busy;
  const playButton = $('story-play');
  if (playButton) {
    playButton.innerHTML = player.running ? (player.paused ? '<span aria-hidden="true">▶</span> Resume' : '<span aria-hidden="true">❚❚</span> Pause')
      : `<span aria-hidden="true">▶</span> ${step === STEPS.length ? 'Play the whole season again' : 'Play the whole season'}`;
    playButton.disabled = state.busy && !player.running;
  }
  const text = $('story-caption');
  text.textContent = caption();
  text.classList.toggle('error', Boolean(state.error));
}

// ---- Ledger -------------------------------------------------------------------------
const LEDGER_NUMBERS = [
  ['capital', 'Pool capital', 'test tokens from three capital providers'],
  ['locked', 'Locked for the policy', 'its maximum payout, held in the pool'],
  ['premiums', 'Premium held', 'paid by the farmer, kept until settlement'],
];
function ledgerHtml() {
  return `<div class="ledger-clock"><span>Test-chain clock</span><strong data-ledger="clock">—</strong><small>contract season dated ${ctx.timeline.coverYear}; rainfall replayed from June–September ${ctx.year}</small></div>
${LEDGER_NUMBERS.map(([key, name, note]) => `<div class="ledger-row" data-row="${key}"><span>${name}</span><strong data-ledger="${key}">0</strong><small>${note}</small></div>`).join('')}
<div class="ledger-row" data-row="policy"><span>Policy</span><strong data-ledger="policy">None yet</strong><small data-ledger="policy-note">two hectares on offer</small></div>
<div class="ledger-row" data-row="rainfall"><span>Rainfall reported</span><strong data-ledger="rainfall">—</strong><small data-ledger="rainfall-note">June–September, pays below ${escape(ctx.triggerShort)} mm</small></div>
<div class="ledger-row" data-row="paid"><span>Paid to the farmer</span><strong data-ledger="paid">—</strong><small>test tokens</small></div>`;
}

function updateLedger(previous, snap, animate) {
  const root = $('story-ledger'), field = key => root.querySelector(`[data-ledger="${key}"]`);
  field('clock').textContent = day(snap.time);
  for (const [key] of LEDGER_NUMBERS) {
    countTo(field(key), previous ? previous[key] : snap[key], snap[key], animate);
    if (animate && previous && previous[key] !== snap[key]) flash(root, key);
  }
  const policy = snap.policy;
  const policyText = !policy ? 'None yet' : policy.state === 3 ? 'Paid' : policy.state === 4 ? 'Closed' : 'Active';
  setText(root, 'policy', policyText, animate && previous);
  field('policy-note').textContent = policy ? `${count(policy.units)} hectares · premium ${fmt(policy.premium)}` : `${count(ctx.units)} hectares on offer`;
  const rain = snap.observation >= 1 ? `${fmt(snap.rainfall)} mm` : '—';
  setText(root, 'rainfall', rain, animate && previous);
  field('rainfall-note').textContent = snap.observation === 3 ? `final · below the ${ctx.triggerShort} mm trigger` : snap.observation === 1 ? 'proposed · in the review period' : `June–September, pays below ${ctx.triggerShort} mm`;
  setText(root, 'paid', snap.paid ? fmt(snap.paid) : '—', animate && previous);
}

function setText(root, key, text, animate) {
  const el = root.querySelector(`[data-ledger="${key}"]`);
  if (el.textContent === text) return;
  el.textContent = text;
  if (animate) flash(root, key);
}

function flash(root, key) {
  const row = root.querySelector(`[data-row="${key}"]`);
  if (!row || reducedMotion.matches) return;
  row.classList.remove('flash');
  void row.offsetWidth;
  row.classList.add('flash');
}

const counting = new WeakMap();
function countTo(el, from, to, animate) {
  if (!el) return;
  const token = {};
  counting.set(el, token);
  if (!animate || reducedMotion.matches || from === to) { el.textContent = fmt(to); return; }
  const begin = performance.now(), duration = 850, whole = Math.abs(to - from) >= 50;
  const tick = now => {
    if (counting.get(el) !== token) return;
    const t = Math.min(1, (now - begin) / duration), eased = 1 - (1 - t) ** 3;
    const value = from + (to - from) * eased;
    el.textContent = t < 1 ? fmt(whole ? Math.round(value) : Math.round(value * 1000) / 1000) : fmt(to);
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ---- Shared pieces ---------------------------------------------------------------------
function head(index, lead) {
  const label = index === 5 ? 'ALL IN ONE' : `CHAPTER ${index + 1} OF 5`;
  return `<div class="stage-head"><span class="eyebrow muted">${label}</span><h3>${CHAPTERS[index].name}</h3><p>${lead}</p></div>`;
}

function svgEl(tag, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

function timelineHtml() {
  const t = ctx.timeline;
  return `<div class="timeline" aria-hidden="true"><div class="timeline-track">${t.labels.map((label, i) => `<div class="timeline-seg" style="--w:${t.weights[i]}"><i></i><span>${escape(label)}</span></div>`).join('')}</div>
<div class="timeline-marker"><b></b></div></div>`;
}

function updateTimeline(root, time) {
  const {points, weights} = ctx.timeline, total = weights.reduce((a, b) => a + b, 0);
  let position = 0;
  root.querySelectorAll('.timeline-seg').forEach((segment, i) => {
    const fraction = Math.min(1, Math.max(0, (time - points[i]) / (points[i + 1] - points[i])));
    segment.querySelector('i').style.width = `${fraction * 100}%`;
    position += fraction * weights[i];
  });
  const marker = root.querySelector('.timeline-marker'), percent = position / total * 100;
  if (!marker) return;
  marker.style.left = `${percent}%`;
  marker.querySelector('b').textContent = day(time);
  marker.classList.toggle('edge-left', percent < 7);
  marker.classList.toggle('edge-right', percent > 93);
}

function checklistHtml(index) {
  const c = CHAPTERS[index];
  return `<ol class="story-steps">${range(c.first, c.last).map(i => `<li data-step="${i}">${i + 1}. ${STEPS[i][1]}</li>`).join('')}</ol>`;
}

function updateChecklist(root, snap) {
  root.querySelectorAll('.story-steps li').forEach(li => {
    const i = Number(li.dataset.step);
    li.className = i < snap.step ? 'done' : i === snap.step ? 'next' : '';
  });
}

// Capital providers, the pool and the farmer, with test tokens moving between them.
function actorsHtml(extraClass = '') {
  const p = ctx.providers;
  return `<svg class="story-svg actors ${extraClass}" viewBox="0 0 720 236" role="img" aria-label="Test tokens moving between the capital providers, the risk pool and the farmer">
<path class="route" data-route="p0" d="M158 43 C212 43 212 88 262 88"/><path class="route" data-route="p1" d="M158 118 C212 118 212 118 262 118"/>
<path class="route" data-route="p2" d="M158 193 C212 193 212 148 262 148"/><path class="route" data-route="premium" d="M560 98 C514 98 506 88 462 88"/>
<path class="route" data-route="payout" d="M462 148 C506 148 514 140 560 140"/>
${p.map((v, i) => `<g class="node provider" data-node="p${i}"><rect x="8" y="${18 + i * 75}" width="150" height="50" rx="8"/><text class="name" x="22" y="${38 + i * 75}">${v.name.toUpperCase()}</text><text class="value" x="22" y="${57 + i * 75}">${fmt(v.amount)}</text></g>`).join('')}
<g class="node pool" data-node="pool"><rect x="262" y="26" width="200" height="186" rx="10"/><text class="name" x="280" y="50">RISK POOL VAULT</text>
<text class="big" data-value="capital" x="280" y="88">0</text><text class="small" x="280" y="106">pool capital · test tokens</text><line class="divider" x1="280" x2="444" y1="122" y2="122"/>
<text class="small" x="280" y="148">Locked for the policy</text><text class="value lock" data-value="locked" x="444" y="148" text-anchor="end">0</text>
<text class="small" x="280" y="180">Premium held</text><text class="value" data-value="premiums" x="444" y="180" text-anchor="end">0</text></g>
<g class="node farmer" data-node="farmer"><rect x="560" y="64" width="152" height="112" rx="8"/><text class="name" x="574" y="86">FARMER · ${ctx.units} HA</text>
<text class="value" data-value="policy" x="574" y="110">No policy yet</text><text class="small" x="574" y="140">Received</text><text class="value" data-value="received" x="574" y="161">0</text></g></svg>`;
}

function updateActors(root, snap, previous, animate) {
  const svg = root.querySelector('.actors');
  if (!svg) return;
  const value = key => svg.querySelector(`[data-value="${key}"]`);
  const funded = snap.capital > 0;
  svg.querySelectorAll('.provider').forEach(node => node.classList.toggle('on', funded));
  svg.querySelector('.pool').classList.toggle('on', funded);
  svg.querySelector('.farmer').classList.toggle('on', Boolean(snap.policy));
  countTo(value('capital'), previous ? previous.capital : snap.capital, snap.capital, animate);
  countTo(value('locked'), previous ? previous.locked : snap.locked, snap.locked, animate);
  countTo(value('premiums'), previous ? previous.premiums : snap.premiums, snap.premiums, animate);
  countTo(value('received'), previous ? previous.paid : snap.paid, snap.paid, animate);
  value('policy').textContent = !snap.policy ? 'No policy yet' : snap.policy.state === 3 ? 'Policy paid' : 'Policy active';
  value('locked').classList.toggle('held', snap.locked > 0);
  if (!animate || !previous) return;
  const route = key => svg.querySelector(`[data-route="${key}"]`);
  if (previous.capital === 0 && snap.capital > 0) ctx.providers.forEach((p, i) => flow(svg, route(`p${i}`), `+${fmt(p.amount)}`, i * 140));
  if (!previous.policy && snap.policy) flow(svg, route('premium'), `+${fmt(snap.policy.premium)} premium`);
  if (!previous.paid && snap.paid) flow(svg, route('payout'), `+${fmt(snap.paid)} payout`);
}

function flow(svg, path, label, delay = 0) {
  if (!path || reducedMotion.matches) return;
  const length = path.getTotalLength(), duration = 1100, dots = [];
  for (let i = 0; i < 5; i++) { const dot = svgEl('circle', {r: 4.5, class: 'flow-dot', opacity: 0}); svg.append(dot); dots.push(dot); }
  path.classList.add('active');
  const begin = performance.now() + delay;
  const tick = now => {
    let alive = false;
    dots.forEach((dot, i) => {
      const t = (now - begin - i * 120) / duration;
      if (t > 1) { dot.remove(); return; }
      alive = true;
      if (t < 0) return;
      const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      const point = path.getPointAtLength(length * eased);
      dot.setAttribute('cx', point.x);
      dot.setAttribute('cy', point.y);
      dot.setAttribute('opacity', 1);
    });
    if (alive) requestAnimationFrame(tick); else path.classList.remove('active');
  };
  requestAnimationFrame(tick);
  if (label) {
    setTimeout(() => {
      const point = path.getPointAtLength(length * 0.5);
      const text = svgEl('text', {x: point.x, y: point.y - 12, 'text-anchor': 'middle', class: 'flow-label'}, label);
      svg.append(text);
      setTimeout(() => text.remove(), 2400);
    }, delay);
  }
}

// ---- Chapter 1: historical rainfall ------------------------------------------------------
function rainfallView(stage) {
  const s = ctx.seasons;
  if (!s.length) {
    stage.innerHTML = head(0, 'The rainfall history could not be loaded.') + '<p class="story-fine">Open Weather evidence or the Pricing lab to inspect it.</p>';
    return {update() {}};
  }
  stage.innerHTML = head(0, `${s.length} June–September seasons, ${s[0].year} to ${s.at(-1).year}, from the Copernicus ERA5-Land reanalysis.`) + `
<div class="stage-grid"><figure class="story-figure"></figure>
<dl class="story-facts"><div><dt>Seasons</dt><dd>${s.length} complete, ${s[0].year}–${s.at(-1).year}</dd></div>
<div><dt>Index area</dt><dd>Land average over 3–15°N, 33–48°E: a box around Ethiopia that also covers neighbouring land</dd></div>
<div><dt>Average season</dt><dd>${fmt(ctx.mean, 1)} mm</dd></div>
<div><dt>Driest season</dt><dd>${ctx.driest.year}: ${fmt(ctx.driest.mm, 1)} mm</dd></div></dl></div>
<p class="story-fine">The ${ctx.driest.year} value may be understated: in September 2022 and June–September 2023 the ERA5-Land monthly product is 36–50% of the hourly series at the two grid points that were compared. The series is used as supplied.</p>`;
  stage.querySelector('.story-figure').append(seasonsChart(s));
  return {update() {}};
}

function seasonsChart(seasons) {
  const W = 620, H = 250, L = 42, R = 10, T = 22, B = 34, w = W - L - R, h = H - T - B;
  const max = Math.ceil(Math.max(...seasons.map(s => s.mm)) * 1.12 / 100) * 100;
  const y = v => T + h - v / max * h, step = w / seasons.length;
  const svg = svgEl('svg', {class: 'story-svg', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Seasonal rainfall ${seasons[0].year}–${seasons.at(-1).year}; driest ${ctx.driest.year} at ${fmt(ctx.driest.mm, 1)} mm`});
  for (let v = 0; v <= max; v += 100) {
    svg.append(svgEl('line', {x1: L, x2: L + w, y1: y(v), y2: y(v), class: 'grid'}));
    svg.append(svgEl('text', {x: L - 8, y: y(v) + 4, 'text-anchor': 'end'}, fmt(v)));
  }
  seasons.forEach((s, i) => {
    const low = s.year === ctx.driest.year;
    const bar = svgEl('rect', {x: L + i * step + 1.5, y: y(s.mm), width: Math.max(1, step - 3), height: T + h - y(s.mm), rx: 1, class: `bar grow${low ? ' low' : ''}`, style: `animation-delay:${i * 18}ms`});
    bar.append(svgEl('title', {}, `${s.year}: ${fmt(s.mm, 1)} mm`));
    svg.append(bar);
    if (s.year % 10 === 5) svg.append(svgEl('text', {x: L + (i + 0.5) * step, y: H - 12, 'text-anchor': 'middle'}, s.year));
    if (low) {
      // Label the driest season above the bars, with a leader line down to its bar.
      const cx = L + (i + 0.5) * step;
      svg.append(svgEl('line', {x1: cx, x2: cx, y1: T - 4, y2: y(s.mm) - 3, class: 'leader'}));
      svg.append(svgEl('text', {x: cx - 5, y: T - 7, 'text-anchor': 'end', class: 'callout'}, `${s.year} · ${fmt(s.mm, 1)} mm`));
    }
  });
  svg.append(svgEl('line', {x1: L, x2: L + w, y1: y(ctx.mean), y2: y(ctx.mean), class: 'mean'}));
  svg.append(svgEl('line', {x1: L, x2: L + 20, y1: T - 11, y2: T - 11, class: 'mean'}));
  svg.append(svgEl('text', {x: L + 26, y: T - 7, class: 'mean-label'}, `${seasons.length}-season average · ${fmt(ctx.mean, 1)} mm`));
  return svg;
}

// ---- Chapter 2: predefined policy --------------------------------------------------------
function pricingView(stage) {
  stage.innerHTML = head(1, `A Gamma distribution fitted to the ${ctx.seasons.length || 41} seasons sets the trigger, and 10,000 simulated seasons set the price.`) + '<div class="pricing-slot"></div>';
  const slot = stage.querySelector('.pricing-slot');
  const draw = () => {
    if (pricing.status === 'done') { slot.replaceChildren(); slot.append(pricingResult(pricing.result)); return; }
    const note = pricing.status === 'running' ? 'Running 10,000 simulated seasons…'
      : pricing.status === 'error' ? `The model could not run in this browser: ${escape(pricing.error)}` : 'Ready to run.';
    slot.innerHTML = `<div class="pricing-wait"><div><strong>The model runs here, in your browser.</strong>
<p>It fits the Gamma distribution the way the team's R script does, then draws 10,000 seasons from it. The first run downloads the model, about 6 MB.</p>
<p class="pricing-status${pricing.status === 'running' ? ' running' : ''}">${note}</p></div>
<div class="pricing-terms"><span class="eyebrow muted">FIXED IN THE RECORDED POLICY</span><div><span>Trigger</span><strong>below ${ctx.triggerShort} mm</strong></div>
<div><span>Premium</span><strong>${ctx.premiumCents} per hectare</strong></div><div><span>Payout</span><strong>${fmt(ctx.maxPerHa)} per hectare</strong></div></div></div>`;
  };
  draw();
  return {update() {}, pricingChanged: draw};
}

function logGamma(z) {
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  let x = c[0];
  for (let i = 1; i < 9; i++) x += c[i] / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function pricingResult(r) {
  const p = r.pricing, fit = r.modelFit;
  const wrap = document.createElement('div');
  wrap.className = 'stage-grid pricing-grid';
  const figure = document.createElement('figure');
  figure.className = 'story-figure';
  figure.append(pricingChart(r));
  figure.insertAdjacentHTML('beforeend', `<figcaption>Bars: ${fmt(r.simulations)} simulated seasons, ochre below the trigger. Line: the fitted Gamma curve. Ticks: the ${(r.seasons ?? []).length} observed seasons.</figcaption>`);
  const probability = new Intl.NumberFormat('en', {style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2}).format(r.simulatedTriggerProbability);
  const parts = PREMIUM_PARTS.map(([key, name], i) => ({name, value: Number(BigInt(p[key])) / 1e6, text: cents(p[key]), i}));
  wrap.append(figure);
  wrap.insertAdjacentHTML('beforeend', `<div class="price-steps">
<div class="price-step reveal" style="--d:.1s"><span class="eyebrow muted">1 · FIT</span><strong>Gamma: shape ${fit.shape.toFixed(2)}, rate ${fit.ratePerMm.toFixed(4)}</strong><p>Its 10th percentile sets the trigger at <b>${fit.tenthPercentileMm.toFixed(2)} mm</b>.</p></div>
<div class="price-step reveal" style="--d:.7s"><span class="eyebrow muted">2 · SIMULATE</span><strong>${probability} of ${fmt(r.simulations)} seasons</strong><p>fall below the trigger.</p></div>
<div class="price-step reveal" style="--d:1.3s"><span class="eyebrow muted">3 · PRICE PER HECTARE</span><strong class="price-total">${cents(p.premiumPerHaBaseUnits)} <small>USDC per hectare</small></strong>
<div class="premium-bar">${parts.map(part => `<i class="k${part.i}" style="flex-grow:${part.value}"></i>`).join('')}</div>
<ul class="premium-legend">${parts.map(part => `<li><i class="k${part.i}"></i><span>${part.name}</span><b>${part.text}</b></li>`).join('')}</ul></div></div>`);
  return wrap;
}

function pricingChart(r) {
  const W = 620, H = 250, L = 46, R = 10, T = 26, B = 44, w = W - L - R, h = H - T - B;
  const bins = r.rainfallHistogram, width = bins[0].highMm - bins[0].lowMm;
  const used = bins.filter(b => b.count > 0), observed = (r.seasons ?? []).map(s => s.rainfallMm);
  const lo = Math.max(0, Math.min(used[0].lowMm, ...observed) - width), hi = Math.max(used.at(-1).highMm, ...observed) + width;
  const x = v => L + (v - lo) / (hi - lo) * w;
  const k = r.modelFit.shape, rate = r.modelFit.ratePerMm, n = r.simulations, lg = logGamma(k);
  const density = v => v <= 0 ? 0 : Math.exp((k - 1) * Math.log(v) - rate * v + k * Math.log(rate) - lg);
  const curve = v => n * density(v) * width;
  const yMax = Math.max(curve((k - 1) / rate), ...bins.map(b => b.count)) * 1.12;
  const y = v => T + h - v / yMax * h;
  const svg = svgEl('svg', {class: 'story-svg', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Simulated seasonal rainfall with the fitted Gamma curve and the trigger'});
  for (let i = 0; i <= 4; i++) {
    const v = yMax * i / 4;
    svg.append(svgEl('line', {x1: L, x2: L + w, y1: y(v), y2: y(v), class: 'grid'}));
    svg.append(svgEl('text', {x: L - 8, y: y(v) + 4, 'text-anchor': 'end'}, fmt(Math.round(v))));
  }
  const trigger = Number(r.parameters.threshold_mm);
  bins.filter(b => b.highMm > lo && b.lowMm < hi).forEach((b, i) => {
    const x0 = x(Math.max(b.lowMm, lo)) + 1, x1 = x(Math.min(b.highMm, hi)) - 1;
    if (b.count - b.triggeredCount > 0) svg.append(svgEl('rect', {x: x0, y: y(b.count), width: Math.max(1, x1 - x0), height: y(b.triggeredCount) - y(b.count), class: 'bar grow', style: `animation-delay:${i * 20}ms`}));
    if (b.triggeredCount > 0) svg.append(svgEl('rect', {x: x0, y: y(b.triggeredCount), width: Math.max(1, x1 - x0), height: T + h - y(b.triggeredCount), class: 'bar low grow', style: `animation-delay:${i * 20}ms`}));
  });
  let d = '';
  for (let v = lo; v <= hi; v += (hi - lo) / 160) d += `${d ? 'L' : 'M'}${x(v).toFixed(1)} ${y(curve(v)).toFixed(1)}`;
  svg.append(svgEl('path', {d, class: 'gamma-curve'}));
  for (const mm of observed) svg.append(svgEl('line', {x1: x(mm), x2: x(mm), y1: T + h + 4, y2: T + h + 12, class: mm < trigger ? 'rug low' : 'rug'}));
  svg.append(svgEl('line', {x1: x(trigger), x2: x(trigger), y1: T - 6, y2: T + h, class: 'trigger'}));
  svg.append(svgEl('text', {x: x(trigger) - 6, y: T - 10, 'text-anchor': 'end', class: 'callout'}, `10th percentile = trigger · ${trigger.toFixed(2)} mm`));
  for (let v = Math.ceil(lo / 100) * 100; v <= hi; v += 100) svg.append(svgEl('text', {x: x(v), y: H - 10, 'text-anchor': 'middle'}, `${fmt(v)}${v + 100 > hi ? ' mm' : ''}`));
  return svg;
}

// ---- Chapter 3: collateral reserved -----------------------------------------------------------
function collateralView(stage) {
  stage.innerHTML = head(2, 'Capital comes in before sales open, and the full maximum payout of a policy is locked the moment it is sold.')
    + timelineHtml() + actorsHtml() + `<div class="stage-foot">${checklistHtml(2)}<p class="terms-line"></p></div>`;
  return {update(snap, previous, animate) {
    updateTimeline(stage, snap.time);
    updateActors(stage, snap, previous, animate);
    updateChecklist(stage, snap);
    stage.querySelector('.terms-line').innerHTML = `<span class="badge ${snap.salesOpen ? 'success' : 'neutral'}">${snap.salesOpen ? 'Sales open' : 'Sales not open'}</span> Trigger below ${ctx.triggerShort} mm · premium ${fmt(ctx.premiumExact, 6)} per hectare · payout ${fmt(ctx.maxPerHa)} per hectare`;
  }};
}

// ---- Chapter 4: rainfall finalized --------------------------------------------------------------
function settlementRainView(stage) {
  stage.innerHTML = head(3, `After the season the agreed index is reported, stays open to challenge for ${count(ctx.reviewDays)} days, and then becomes final.`) + timelineHtml() + `
<div class="rain-grid"><dl class="index-card"><div><dt>Area</dt><dd>Land average over 3–15°N, 33–48°E (ERA5-Land monthly), a box around Ethiopia</dd></div>
<div><dt>Period</dt><dd>June to September</dd></div><div><dt>Method</dt><dd>The four monthly values added up</dd></div>
<div><dt>Pays when</dt><dd>The total is strictly below ${ctx.triggerShort} mm</dd></div><div><dt>Season replayed</dt><dd>${ctx.year}, on the ${ctx.timeline.coverYear} test season</dd></div></dl>
<figure class="story-figure gauge-figure"></figure>
<div class="oracle"><ol class="pipeline"><li data-k="reported"><span></span><div><strong>Reported</strong><small></small></div></li>
<li data-k="review"><span></span><div><strong>${initial(count(ctx.reviewDays))}-day review</strong><small></small></div></li><li data-k="final"><span></span><div><strong>Final</strong><small></small></div></li></ol>
<p class="branch"><strong>If challenged</strong> with evidence, an independent resolver decides the final value. Not used in this run.</p>
<p class="story-fine">A local test forwarder delivers the report in place of a Chainlink oracle network. <a class="evidence-link" target="_blank" rel="noopener noreferrer" hidden>Open the evidence file ↗</a></p></div></div>
<div class="stage-foot">${checklistHtml(3)}</div>`;
  stage.querySelector('.gauge-figure').append(gaugeSvg());
  let shown = null;
  return {update(snap) {
    updateTimeline(stage, snap.time);
    updateChecklist(stage, snap);
    const reported = snap.observation >= 1;
    if (shown !== reported) { fillGauge(stage, reported ? snap.rainfall : null); shown = reported; }
    const item = key => stage.querySelector(`[data-k="${key}"]`);
    const setItem = (key, status, text) => { item(key).className = status; item(key).querySelector('small').textContent = text; };
    setItem('reported', reported ? 'done' : '', reported ? `${day(snap.proposedAt)} · ${fmt(snap.rainfall)} mm` : `not before ${day(ctx.manifest.reportNotBefore)}`);
    const reviewOver = snap.observation === 3 || (reported && snap.time >= snap.challengeEnds);
    setItem('review', reviewOver ? 'done' : reported ? 'active' : '', reviewOver ? 'ended without a challenge' : reported ? `open to challenge until ${day(snap.challengeEnds)}` : `${count(ctx.reviewDays)} days after the report`);
    setItem('final', snap.observation === 3 ? 'done' : '', snap.observation === 3 ? `${fmt(snap.rainfall)} mm, below the trigger` : 'after the review');
    const link = stage.querySelector('.evidence-link');
    link.hidden = !snap.evidenceUrl;
    if (snap.evidenceUrl) link.href = snap.evidenceUrl;
  }};
}

function gaugeSvg() {
  const W = 250, H = 250, top = 34, base = 214, max = ctx.trigger * 1.22, cx = 102;
  const y = v => base - v / max * (base - top);
  const svg = svgEl('svg', {class: 'story-svg gauge', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `June–September ${ctx.year} rainfall against the ${ctx.triggerShort} mm trigger`});
  svg.append(svgEl('rect', {x: cx - 34, y: top, width: 68, height: base - top, rx: 3, class: 'gauge-frame'}));
  const parts = ctx.months.length === 4 && Math.abs(ctx.months.reduce((s, m) => s + m.mm, 0) - ctx.final.rainfall) < 0.0005 ? ctx.months : [{month: 0, mm: ctx.final.rainfall}];
  let level = 0;
  const names = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  parts.forEach((part, i) => {
    const group = svgEl('g', {class: 'gauge-part', style: `--d:${i * 0.35}s`});
    group.append(svgEl('rect', {x: cx - 34, y: y(level + part.mm), width: 68, height: y(level) - y(level + part.mm), class: `gauge-seg s${i}`}));
    if (part.month) group.append(svgEl('text', {x: cx + 42, y: (y(level) + y(level + part.mm)) / 2 + 4, class: 'gauge-label'}, `${names[part.month]} ${fmt(part.mm, 1)}`));
    svg.append(group);
    level += part.mm;
  });
  svg.append(svgEl('text', {x: cx, y: y(level) - 10, 'text-anchor': 'middle', class: 'gauge-total'}, `${fmt(level)} mm`));
  svg.append(svgEl('text', {x: cx, y: (top + base) / 2, 'text-anchor': 'middle', class: 'gauge-wait'}, 'awaiting report'));
  svg.append(svgEl('line', {x1: 14, x2: 240, y1: y(ctx.trigger), y2: y(ctx.trigger), class: 'trigger'}));
  svg.append(svgEl('text', {x: 14, y: y(ctx.trigger) - 7, class: 'callout'}, `Trigger ${ctx.triggerShort} mm`));
  svg.append(svgEl('line', {x1: 14, x2: 240, y1: base, y2: base, class: 'baseline'}));
  svg.append(svgEl('text', {x: cx, y: base + 22, 'text-anchor': 'middle'}, `June–September ${ctx.year}`));
  return svg;
}

function fillGauge(root, rainfall) {
  const svg = root.querySelector('.gauge');
  if (svg) svg.classList.toggle('filled', rainfall !== null);
}

// ---- Chapter 5: payout or release ----------------------------------------------------------------
function payoutView(stage) {
  const l = ctx.ledger;
  stage.innerHTML = head(4, 'Settlement compares the final rainfall with the trigger. Nobody has to assess the farm.') + `
<div class="outcomes"><article class="outcome" data-outcome="pay"><span class="eyebrow">BELOW ${ctx.triggerShort} MM</span><strong>Pay ${fmt(ctx.maxPerHa)} per hectare</strong><p></p></article>
<article class="outcome" data-outcome="release"><span class="eyebrow">${ctx.triggerShort} MM OR MORE</span><strong>No payout</strong><p>The ${fmt(ctx.maxPayout)} locked for the policy goes back to the pool.</p></article></div>
${actorsHtml('payout-actors')}
${l.balances ? `<div class="equation" hidden><div><strong>${fmt(l.start)}</strong><span>provider capital</span></div><b>+</b><div><strong>${fmt(l.premium)}</strong><span>premium</span></div><b>−</b>
<div><strong>${fmt(l.fee)}</strong><span>operating fee</span></div><b>−</b><div><strong>${fmt(l.payout)}</strong><span>payout</span></div><b>=</b>
<div class="result"><strong>${fmt(l.end)}</strong><span>capital after the season</span></div></div>` : ''}
<div class="stage-foot">${checklistHtml(4)}</div>`;
  return {update(snap, previous, animate) {
    updateActors(stage, snap, previous, animate);
    updateChecklist(stage, snap);
    const final = snap.observation === 3, below = final && snap.rainfall < ctx.trigger;
    const pay = stage.querySelector('[data-outcome="pay"]'), release = stage.querySelector('[data-outcome="release"]');
    pay.className = `outcome${below ? ' taken' : ''}${snap.paid ? ' paid' : ''}`;
    release.className = `outcome${final ? (below ? ' not-taken' : ' taken') : ''}`;
    pay.querySelector('p').textContent = snap.paid ? `${fmt(snap.rainfall)} mm this season: ${fmt(snap.paid)} paid to the farmer ✓`
      : below ? `${fmt(snap.rainfall)} mm this season: ${fmt(ctx.maxPayout)} due at settlement` : `${fmt(ctx.maxPayout)} for this ${count(ctx.units)}-hectare policy`;
    const equation = stage.querySelector('.equation');
    if (equation) equation.hidden = !snap.paid;
  }};
}

// ---- All in one ------------------------------------------------------------------------------------
function wholeView(stage) {
  const s = ctx.seasons;
  const card = (i, title, inner) => `<article class="whole-card" data-card="${i}"><span class="whole-num">${i + 1}</span><h4>${title}</h4>${inner}</article>`;
  const link = i => `<div class="whole-link" data-link="${i}" aria-hidden="true"><i></i></div>`;
  stage.innerHTML = head(5, 'Every step of the season on one screen, from the rainfall record to the payment.')
    + `<div class="whole-controls"><button class="button primary" id="story-play" type="button"></button>
<button class="text-button" id="story-speed" type="button" aria-pressed="${player.slow}">Speed: ${player.slow ? 'slow' : 'normal'}</button></div>`
    + timelineHtml() + `<div class="whole">
${card(0, 'Historical rainfall', `<div class="whole-viz"></div><strong>${s.length} seasons</strong><small>${s.length ? `${s[0].year}–${s.at(-1).year} · driest ${ctx.driest.year}` : ''}</small>`)}${link(0)}
${card(1, 'Predefined policy', `<div class="whole-viz"><div class="premium-bar small"></div></div><strong data-w="premium"></strong><small>per hectare · pays below ${ctx.triggerShort} mm</small>`)}${link(1)}
${card(2, 'Collateral reserved', `<div class="whole-viz"><div class="mini-pool"><i></i></div><span class="mini-lock" data-w="lock"></span></div><strong data-w="capital"></strong><small data-w="capital-note"></small>`)}${link(2)}
${card(3, 'Rainfall finalized', '<div class="whole-viz whole-gauge"></div><strong data-w="rain"></strong><small data-w="rain-note"></small>')}${link(3)}
${card(4, 'Payout or release', '<div class="whole-viz"><span class="pay-badge" data-w="badge"></span></div><strong data-w="paid"></strong><small data-w="paid-note"></small>')}</div>`;
  if (s.length) stage.querySelector('[data-card="0"] .whole-viz').append(miniSeasons(s));
  stage.querySelector('.whole-gauge').append(miniGauge());
  stage.querySelector('#story-play').addEventListener('click', () => void play());
  stage.querySelector('#story-speed').addEventListener('click', event => {
    player.slow = !player.slow;
    event.currentTarget.textContent = `Speed: ${player.slow ? 'slow' : 'normal'}`;
    event.currentTarget.setAttribute('aria-pressed', String(player.slow));
    chrome();
  });
  const field = key => stage.querySelector(`[data-w="${key}"]`);
  return {
    update(snap) {
      updateTimeline(stage, snap.time);
      const states = cardStates(snap);
      stage.querySelectorAll('.whole-card').forEach((el, i) => { el.dataset.state = states[i]; });
      stage.querySelectorAll('.whole-link').forEach((el, i) => el.classList.toggle('lit', states[i + 1] !== 'todo'));
      field('premium').textContent = premiumText();
      const bar = stage.querySelector('.premium-bar.small');
      bar.innerHTML = pricing.result ? PREMIUM_PARTS.map(([key], i) => `<i class="k${i}" style="flex-grow:${Number(BigInt(pricing.result.pricing[key])) / 1e6}"></i>`).join('') : '<i class="k0" style="flex-grow:1"></i>';
      // Once the policy is bought this card keeps showing what was reserved; the ledger shows the live pool.
      const pool = snap.step >= 4 ? ctx.reserved : snap;
      field('capital').textContent = fmt(pool.capital);
      field('capital-note').textContent = snap.step >= 4 ? `reserved · ${fmt(pool.locked)} locked for the policy` : snap.capital ? `pool · ${fmt(snap.locked)} locked` : 'pool not funded yet';
      stage.querySelector('.mini-pool i').style.width = `${Math.min(100, pool.capital / Math.max(ctx.ledger.start, 1) * 100)}%`;
      field('lock').textContent = pool.locked ? `${fmt(pool.locked)} locked` : '';
      field('rain').textContent = snap.observation >= 1 ? `${fmt(snap.rainfall)} mm` : '—';
      field('rain-note').textContent = snap.observation === 3 ? 'final · below the trigger' : snap.observation === 1 ? 'reported · in review' : 'not reported yet';
      stage.querySelector('.mini-gauge').classList.toggle('filled', snap.observation >= 1);
      field('paid').textContent = snap.paid ? `${fmt(snap.paid)} paid` : '—';
      field('paid-note').textContent = snap.paid ? 'to the farmer · no loss assessment' : snap.observation === 3 ? 'due at settlement' : 'after the rainfall is final';
      field('badge').textContent = snap.paid ? 'Paid ✓' : snap.observation === 3 ? 'Due' : '';
      field('badge').classList.toggle('on', Boolean(snap.paid));
    },
    runLink(i) {
      const el = stage.querySelector(`[data-link="${i}"]`);
      if (!el || reducedMotion.matches) return;
      el.classList.remove('run');
      void el.offsetWidth;
      el.classList.add('run');
    },
    pricingChanged() { this.update(state.snap); },
  };
}

function cardStates(snap) {
  if (player.running && player.active !== null) return [0, 1, 2, 3, 4].map(i => i < player.active ? 'done' : i === player.active ? 'active' : 'todo');
  if (player.running) return ['todo', 'todo', 'todo', 'todo', 'todo'];
  const step = snap.step;
  return ['done', 'done', step >= 4 ? 'done' : step > 0 ? 'active' : 'todo', step >= 8 ? 'done' : step > 4 ? 'active' : 'todo', step >= 9 ? 'done' : 'todo'];
}

function miniSeasons(seasons) {
  const W = 164, H = 52, max = Math.max(...seasons.map(s => s.mm)), step = W / seasons.length;
  const svg = svgEl('svg', {class: 'mini', viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true', preserveAspectRatio: 'none'});
  seasons.forEach((s, i) => svg.append(svgEl('rect', {x: i * step + 0.5, y: H - s.mm / max * H, width: Math.max(1, step - 1), height: s.mm / max * H, class: s.year === ctx.driest.year ? 'bar low' : 'bar'})));
  return svg;
}

function miniGauge() {
  const W = 120, H = 52, max = ctx.trigger * 1.22, y = v => H - v / max * (H - 4);
  const svg = svgEl('svg', {class: 'mini mini-gauge', viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true'});
  svg.append(svgEl('rect', {x: 46, y: 4, width: 28, height: H - 4, rx: 2, class: 'gauge-frame'}));
  svg.append(svgEl('rect', {x: 46, y: y(ctx.final.rainfall), width: 28, height: H - y(ctx.final.rainfall), class: 'gauge-seg s0 mini-fill'}));
  svg.append(svgEl('line', {x1: 20, x2: 100, y1: y(ctx.trigger), y2: y(ctx.trigger), class: 'trigger'}));
  return svg;
}
