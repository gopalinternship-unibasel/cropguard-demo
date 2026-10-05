/** Research-only UI. Does not import the wallet or prepare transactions. */
import { money, exactMoney, percent } from './risk-format.js';
import { readEvidenceJson, evidenceJsonBlob } from './json-evidence.js';

const $ = id => document.getElementById(id);
const form = $('simulation-form');
const state = { report: null, request: null, busy: false, stale: false, chart: 'rainfall', sourcesLoading: false };
const era5Parameters = new Set(['era5_land:total_precipitation', 'era5_land_timeseries:total_precipitation']);
const era5Providers = new Set(['era5_land', 'era5_land_timeseries']);
const NS = 'http://www.w3.org/2000/svg';
const colors = { green: '#91a780', dark: '#36583f', gold: '#bd9b61', light: '#e5ebdc', line: '#b89962' };
const number = value => new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value);
function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}
function svgEl(tag, attrs = {}, text) {
  const n = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) n.setAttribute(key, String(value));
  if (text !== undefined) n.textContent = text;
  return n;
}
function setMoney(id, value, suffix = '') {
  $(id).textContent = money(value) + suffix;
  $(id).title = exactMoney(value) + ' USDC (exact base-unit result)';
}
function feedback(text, error = false) {
  $('simulation-feedback').textContent = text;
  $('simulation-feedback').dataset.error = String(error);
}
function updateExports() {
  $('export-report').disabled = !state.report || state.busy || state.stale;
  $('export-draws').disabled = !state.report || state.busy || state.stale;
}
function stale() {
  if (state.busy) return;
  state.stale = Boolean(state.report);
  $('stale-badge').classList.toggle('hidden', !state.stale);
  if (state.stale) feedback('Settings changed. Run again to update the displayed estimate.');
  updateExports();
}
function sourceControls() {
  const saved = $('sim-source').value === 'ethiopia_archive';
  const ready = !saved || Boolean($('sim-snapshot').value);
  $('saved-station-options').classList.toggle('hidden', !saved);
  $('sim-source-note').textContent = !saved
    ? 'Included Copernicus ERA5-Land history for Adama, 1985–2025. Its file checksum is verified before analysis; Gamma trials are simulated.'
    : state.sourcesLoading ? 'Checking the local ERA5-Land archive…' : ready
    ? 'ERA5-Land reanalysis is the historical input. Gamma trials are simulated from that history.'
    : $('sim-snapshot').options.length > 1 ? 'Select a saved ERA5-Land history for this simulation.'
    : 'ERA5-Land history is not imported yet. Import the Copernicus download, then refresh saved sources.';
  $('sim-snapshot').required = saved;
  $('sim-snapshot').disabled = !saved || state.busy || state.sourcesLoading;
  $('refresh-simulation-sources').disabled = !saved || state.busy || state.sourcesLoading;
  $('run-simulation').disabled = state.busy || (saved && state.sourcesLoading) || !ready;
  $('sim-start-year').disabled = state.busy;
  $('sim-start-year').required = true;
  thresholdControls();
}
function thresholdControls() {
  const calibrated = $('sim-threshold-mode').value === 'gamma_p10';
  $('sim-threshold').readOnly = calibrated;
  $('sim-method').disabled = state.busy || calibrated;
  if (calibrated) $('sim-method').value = 'gamma';
  $('sim-threshold-note').textContent = calibrated
    ? 'Calculated from the selected ERA5-Land history each run. Current Adama baseline: 170.678 mm.'
    : 'Editable fixed trigger. The presentation uses 297.29 mm; it is a comparison value, not the calibrated Adama trigger.';
}
function setBusy(busy) {
  state.busy = busy;
  form.querySelectorAll('input,select,textarea,button').forEach(n => { n.disabled = busy; });
  sourceControls();
  $('run-simulation').firstElementChild.textContent = busy ? 'Running simulation…' : 'Run simulation';
  $('lab-results').setAttribute('aria-busy', String(busy));
  updateExports();
}
function readInputs() {
  return {
    source: $('sim-source').value,
    ...($('sim-source').value === 'ethiopia_archive' ? {snapshot_id: $('sim-snapshot').value} : {}),
    history_start_year: Number($('sim-start-year').value),
    training_cutoff_year: Number($('sim-cutoff').value),
    first_month: Number($('sim-first-month').value), month_count: Number($('sim-month-count').value),
    threshold_mm: $('sim-threshold').value.trim(), maximum_usdc: $('sim-maximum').value.trim(),
    threshold_mode: $('sim-threshold-mode').value,
    hectares: Number($('sim-hectares').value), period_capital_bps: Math.round(Number($('sim-capital').value) * 100),
    operating_fee_usdc: $('sim-fee').value.trim(), oracle_failure_allowance_usdc: $('sim-failure').value.trim(),
    simulations: Number($('sim-trials').value), method: $('sim-method').value, seed: Number($('sim-seed').value),
    rainfall_change_bps: Math.round(Number($('sim-stress').value) * 100)
  };
}
async function post(path, body, asBlob = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
    if (!response.ok) {
      let data;
      try { data = await response.json(); } catch { throw new Error(`The service returned HTTP ${response.status}.`); }
      const detail = Array.isArray(data.detail) ? data.detail.map(x => `${x.loc?.slice(1).join('.')}: ${x.msg}`).join('; ') : data.detail;
      throw new Error(detail || 'The simulation could not be completed.');
    }
    return asBlob ? { blob: await response.blob(), hash: response.headers.get('X-Analysis-Hash') } : await readEvidenceJson(response);
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The request timed out. No fallback data was substituted.');
    throw error;
  } finally { clearTimeout(timer); }
}
async function run() {
  if (state.busy || ($('sim-source').value === 'ethiopia_archive' && (state.sourcesLoading || !$('sim-snapshot').value)) || !form.reportValidity()) return;
  const body = readInputs();
  setBusy(true);
  feedback(`Sampling ${number(body.simulations)} seasons and checking the payout rule…`);
  try {
    const result = await post('/api/simulation/run', body);
    if (result.source.synthetic !== false || !era5Providers.has(result.source.provider)) throw new Error('The result is not backed by verified ERA5-Land history.');
    state.report = result;
    state.request = body;
    state.stale = false;
    $('stale-badge').classList.add('hidden');
    render(result);
    feedback(`Completed ${number(result.simulations)} trials. Seed ${result.parameters.seed}. No transactions sent.`);
  } catch (error) {
    state.stale = Boolean(state.report);
    $('stale-badge').classList.toggle('hidden', !state.stale);
    feedback(`${error.message}${state.report ? ' The displayed result is from the previous successful run.' : ''}`, true);
    if (!state.report) {
      $('simulation-empty').replaceChildren(el('span', 'eyebrow muted', 'SIMULATION NOT COMPLETED'), el('h3', '', 'Check the source.\nThen try again.'), el('p', '', error.message), el('small', '', 'No missing values or results were invented.'));
    }
  } finally { setBusy(false); }
}
function render(r) {
  $('simulation-empty').classList.add('hidden');
  $('simulation-result').classList.remove('hidden');
  const pricing = r.pricing;
  $('sim-threshold').value = r.parameters.threshold_mm;
  $('simulation-source-badge').textContent = 'ERA5-Land history · model-simulated trials';
  $('simulation-source-badge').className = 'badge success';
  $('simulation-run-label').textContent = `${number(r.simulations)} trials · ${r.parameters.method === 'bootstrap' ? 'Season bootstrap' : 'Gamma model'} · seed ${r.parameters.seed}`;
  setMoney('sim-price', pricing.premiumPerHaBaseUnits);
  $('sim-total-price').textContent = `${money(pricing.totalPremiumBaseUnits)} USDC for ${number(r.parameters.hectares)} hectares`;
  $('sim-total-price').title = exactMoney(pricing.totalPremiumBaseUnits) + ' USDC';
  setMoney('sim-expected', pricing.expectedLossPerHaBaseUnits);
  setMoney('sim-capital-result', pricing.capitalCostPerHaBaseUnits);
  setMoney('sim-fee-result', pricing.operatingFeePerHaBaseUnits);
  setMoney('sim-failure-result', pricing.oracleFailureAllowancePerHaBaseUnits);
  $('failure-cost-row').classList.toggle('hidden', BigInt(pricing.oracleFailureAllowancePerHaBaseUnits) === 0n);
  setMoney('sim-breakdown-total', pricing.premiumPerHaBaseUnits);
  $('sim-probability').textContent = new Intl.NumberFormat('en', {style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2}).format(r.simulatedTriggerProbability);
  $('sim-years').textContent = r.completeSeasons;
  $('sim-year-range').textContent = `${r.trainingFirstYear}–${r.trainingLastYear}${r.source.synthetic ? ' · synthetic' : ''}`;
  setMoney('sim-var', pricing.var995BaseUnits);
  setMoney('sim-buffer', pricing.solvencyBufferBaseUnits);
  setMoney('sim-collateral', pricing.requiredCollateralBaseUnits, ' USDC');
  setMoney('sim-es', r.tailRisk[0].expectedShortfallBaseUnits);
  setMoney('sim-var99', r.tailRisk[1].varBaseUnits);
  $('sim-mc-interval').textContent = r.monteCarloWilsonInterval95.map(x => percent(x)).join(' – ');
  $('sim-historical-prob').textContent = percent(r.historicalTriggerProbability);
  $('sim-historical-upper').textContent = percent(r.historicalWilsonUpperOneSided95);
  methodology(r);
  chart();
}
function methodology(r) {
  const target = $('simulation-methodology');
  target.replaceChildren();
  target.append(el('h4', '', r.source.label), el('p', '', r.source.notes || 'No additional source notes supplied.'));
  target.append(el('p', '', `Source verification: ${r.source.verification.replaceAll('_', ' ')}. Input records: ${r.source.monthlyRecords}. Complete training seasons: ${r.completeSeasons}.`));
  if (r.source.actualGridPoint) target.append(el('p', '', `Returned grid cell: ${r.source.actualGridPoint.map(number).join(', ')}. This is one cell, not a farm-area average.`));
  if (r.source.sourceUrl && /^https:\/\//.test(r.source.sourceUrl)) {
    const a = el('a', 'text-link', 'Inspect the rainfall source ↗');
    a.href = r.source.sourceUrl; a.target = '_blank'; a.rel = 'noopener noreferrer'; target.append(a);
  }
  target.append(el('h4', '', 'The model and the rate'));
  target.append(el('p', '', r.parameters.method === 'bootstrap'
    ? 'Each trial resamples one complete input season, keeping that season’s months together. It then applies the rainfall stress and the same strict binary drought threshold. It does not invent unseen extremes.'
    : 'Strictly positive seasonal totals are fitted to a Gamma distribution by maximum likelihood, with location fixed at zero. Zero or constant seasons are rejected; use bootstrap for those cases. This stationary model can extrapolate into an unobserved tail, but its parameters and fit are not certified.'));
  if (r.parameters.method === 'gamma') target.append(el('p', '', `Fitted 10th percentile: ${r.modelFit.tenthPercentileMm.toFixed(3)} mm. Gamma shape: ${r.modelFit.shape.toPrecision(6)}; scale: ${r.modelFit.scaleMm.toPrecision(6)} mm. ${r.parameters.threshold_mode === 'gamma_p10' ? 'The selected local calibration uses this fitted percentile as the payout trigger, rounded to 0.001 mm.' : 'The selected fixed payout threshold is retained separately from this calibration.'}`));
  target.append(el('p', '', `Payout per hectare is ${money(r.pricing.maximumPerHaBaseUnits)} USDC only when simulated seasonal rainfall is strictly below ${r.parameters.threshold_mm} mm; equality pays zero. All ${r.parameters.hectares} hectares share one index.`));
  target.append(el('p', '', 'Premium = average simulated payout + term rate × max(99.5% pool VaR − expected pool loss, 0) / hectares + operating fee + explicit oracle-failure allowance. USDC calculations retain six-decimal base units; headline values are displayed to two decimals. No rate is registered or approved automatically.'));
  target.append(el('h4', '', 'Sampling noise is not climate uncertainty'));
  target.append(el('p', '', `The Monte Carlo interval uses ${number(r.simulations)} simulated trials conditional on the selected model. The historical one-sided 95% Wilson bound uses only ${r.completeSeasons} input seasons and is not added to the displayed premium. Both require their respective sampling assumptions.`));
  target.append(el('p', '', `The walk-forward Brier score (${r.meanWalkForwardBrierScore.toFixed(4)}) is a diagnostic of the historical empirical-frequency baseline, using earlier seasons only. It does not validate the Gamma model or a future climate scenario.`));
  target.append(el('h4', '', 'Limitations to keep in view'));
  const list = el('ul'); for (const warning of r.warnings) list.append(el('li', '', warning)); target.append(list);
  target.append(el('h4', '', 'Reproducible evidence'), el('p', '', `Python ${r.pythonVersion} · seed ${r.parameters.seed}. The JSON report includes the monthly input dataset, parameters, model fit, chart data, warnings and hashes. Exported trials are simulated, not measured.`));
  target.append(el('p', '', 'Input content hash'), el('code', '', r.source.contentHash), el('p', '', 'Analysis hash'), el('code', '', r.analysisHash));
}
function tooltip(mark, text) {
  mark.setAttribute('tabindex', '0');
  mark.setAttribute('class', 'chart-mark');
  mark.setAttribute('role', 'img');
  mark.setAttribute('aria-label', text);
  mark.append(svgEl('title', {}, text));
  mark.addEventListener('mouseenter', () => { $('simulation-chart-hint').textContent = text; });
  mark.addEventListener('focus', () => { $('simulation-chart-hint').textContent = text; });
  return mark;
}
function frame(yMax, opts = {}) {
  const width = window.innerWidth < 480 ? 470 : 640;
  const height = 260, left = 47, right = 17, top = 16, bottom = 44;
  const w = width - left - right, h = height - top - bottom;
  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-labelledby': 'simulation-chart-title simulation-chart-caption' });
  const y = value => top + h - value / Math.max(yMax, 1e-10) * h;
  for (let i = 0; i <= 4; i++) {
    const value = yMax * i / 4;
    svg.append(svgEl('line', { x1: left, x2: left+w, y1: y(value), y2: y(value), class: 'grid-line' }));
    svg.append(svgEl('text', { x: left-9, y: y(value)+4, 'text-anchor': 'end' }, opts.percent ? `${Math.round(value*100)}%` : number(value)));
  }
  return { svg, y, left, w, h, top, height, width, base: top+h };
}
function title(name, caption, unit) {
  $('simulation-chart-title').textContent = name;
  $('simulation-chart-caption').textContent = caption;
  $('simulation-chart-unit').textContent = unit;
  $('simulation-chart-hint').textContent = 'Hover over or focus a mark to inspect its value.';
}
function rainfall(r) {
  title('The shape of a season', `Simulated totals. Ochre marks trials below the ${r.parameters.threshold_mm} mm trigger; green marks the rest.`, 'TRIALS');
  const bins = r.rainfallHistogram;
  const f = frame(Math.ceil(Math.max(...bins.map(b => b.count))*1.15));
  const max = bins.at(-1).highMm;
  const x = value => f.left+value/max*f.w;
  for (const bin of bins) {
    const bx = x(bin.lowMm)+1.4, bw = Math.max(1, x(bin.highMm)-x(bin.lowMm)-2.8);
    const non = bin.count-bin.triggeredCount;
    if (non) f.svg.append(tooltip(svgEl('rect', { x: bx, y: f.y(bin.count), width: bw, height: f.y(bin.triggeredCount)-f.y(bin.count), fill: colors.green, rx: 1 }), `${number(bin.lowMm)}–${number(bin.highMm)} mm: ${number(non)} non-trigger trials.`));
    if (bin.triggeredCount) f.svg.append(tooltip(svgEl('rect', { x: bx, y: f.y(bin.triggeredCount), width: bw, height: f.base-f.y(bin.triggeredCount), fill: colors.gold, rx: 1 }), `${number(bin.lowMm)}–${number(bin.highMm)} mm: ${number(bin.triggeredCount)} drought-trigger trials.`));
  }
  const trigger = x(Number(r.parameters.threshold_mm));
  f.svg.append(svgEl('line', { x1: trigger, x2: trigger, y1: f.top, y2: f.base, class: 'threshold' }));
  for (let i=0;i<=4;i++) f.svg.append(svgEl('text', { x: x(max*i/4), y: f.base+24, 'text-anchor': 'middle' }, number(max*i/4)));
  f.svg.append(svgEl('text', { x: f.left+f.w, y: f.height-3, 'text-anchor': 'end', class: 'axis-label' }, 'SEASONAL RAINFALL · mm'));
  return f.svg;
}
function history(r) {
  title(r.source.synthetic ? 'The synthetic input seasons' : 'The complete input seasons', `Unstressed seasonal totals through ${r.parameters.training_cutoff_year}. Ochre seasons are below the selected trigger.`, 'mm');
  const maximum = Math.max(Number(r.parameters.threshold_mm), ...r.seasons.map(s=>s.rainfallMm))*1.15;
  const f=frame(maximum);
  const step=f.w/r.seasons.length;
  r.seasons.forEach((s,i) => {
    const bar=svgEl('rect',{x:f.left+i*step+1,y:f.y(s.rainfallMm),width:Math.max(1,step-2),height:Math.max(1,f.base-f.y(s.rainfallMm)),fill:s.triggered?colors.gold:colors.green,rx:1});
    f.svg.append(tooltip(bar,`${s.year}: ${number(s.rainfallMm)} mm · ${s.triggered?'triggered':'no trigger'}${r.source.synthetic?' · synthetic':''}.`));
    if (i===0||i===r.seasons.length-1||i%10===0) f.svg.append(svgEl('text',{x:f.left+(i+.5)*step,y:f.base+24,'text-anchor':'middle'},s.year));
  });
  f.svg.append(svgEl('line',{x1:f.left,x2:f.left+f.w,y1:f.y(Number(r.parameters.threshold_mm)),y2:f.y(Number(r.parameters.threshold_mm)),class:'threshold'}));
  return f.svg;
}
function convergence(r) {
  title('Does the estimate settle down?', 'Running expected loss per hectare. The band shows 95% Monte Carlo uncertainty, not future-weather certainty.', 'USDC / ha');
  const series=r.convergence;
  const max=Math.max(...series.map(p=>p.upperUsdcPerHa),1)*1.12;
  const f=frame(max), x=t=>f.left+t/r.simulations*f.w;
  const upper=series.map(p=>`${x(p.trials)},${f.y(p.upperUsdcPerHa)}`);
  const lower=series.slice().reverse().map(p=>`${x(p.trials)},${f.y(p.lowerUsdcPerHa)}`);
  f.svg.append(svgEl('polygon',{points:upper.concat(lower).join(' '),fill:colors.light}));
  f.svg.append(svgEl('polyline',{points:series.map(p=>`${x(p.trials)},${f.y(p.expectedLossUsdcPerHa)}`).join(' '),fill:'none',stroke:colors.dark,'stroke-width':2}));
  series.forEach((p,i)=>{if(i%4===0||i===series.length-1)f.svg.append(tooltip(svgEl('circle',{cx:x(p.trials),cy:f.y(p.expectedLossUsdcPerHa),r:3.5,fill:colors.dark}),`${number(p.trials)} trials: ${number(p.expectedLossUsdcPerHa)} USDC expected loss/ha. Conditional 95% interval: ${number(p.lowerUsdcPerHa)}–${number(p.upperUsdcPerHa)}.`));});
  for(let i=0;i<=4;i++)f.svg.append(svgEl('text',{x:x(r.simulations*i/4),y:f.base+24,'text-anchor':'middle'},number(r.simulations*i/4)));
  f.svg.append(svgEl('text',{x:f.left+f.w,y:f.height-3,'text-anchor':'end',class:'axis-label'},'SIMULATED SEASONS'));
  return f.svg;
}
function stress(r) {
  title('What happens when rainfall changes?', `Additional stress relative to this run’s ${r.parameters.rainfall_change_bps/100}% rainfall change. Same random draws, different rainfall levels.`, 'PROBABILITY');
  const f=frame(1,{percent:true}),step=f.w/r.sensitivity.length;
  r.sensitivity.forEach((s,i)=>{
    const x=f.left+i*step+step*.18;
    const change=s.additionalRainfallChangePercent;
    const text=`${change>0?'+':''}${change}% rainfall: ${percent(s.probability)} trigger probability; ${money(s.premiumPerHaBaseUnits)} USDC premium/ha. Scenario, not forecast.`;
    f.svg.append(tooltip(svgEl('rect',{x,y:f.y(s.probability),width:step*.64,height:Math.max(1,f.base-f.y(s.probability)),fill:change<0?colors.gold:change===0?colors.dark:colors.green,rx:2}),text));
    f.svg.append(svgEl('text',{x:x+step*.32,y:f.base+24,'text-anchor':'middle'},`${change>0?'+':''}${change}%`));
  });
  return f.svg;
}
function chart() {
  if (!state.report) return;
  const draw = { rainfall, history, convergence, stress }[state.chart];
  $('simulation-chart').replaceChildren(draw(state.report));
  $('simulation-chart-panel').setAttribute('aria-labelledby', `tab-${state.chart}`);
}
function selectChart(kind) {
  state.chart = kind;
  document.querySelectorAll('[data-chart]').forEach(n => {
    const active=n.dataset.chart===kind;
    n.classList.toggle('active',active); n.setAttribute('aria-selected',String(active)); n.tabIndex=active?0:-1;
  });
  chart();
}
function download(blob, filename) {
  const url=URL.createObjectURL(blob),a=el('a'); a.href=url; a.download=filename; document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('export-report').onclick=()=>{
  if (!state.report||state.stale||state.busy) return;
  download(evidenceJsonBlob(state.report),`cropguard-${state.report.source.synthetic?'synthetic-':''}risk-report.json`);
};
$('export-draws').onclick=async()=>{
  if (!state.report||state.stale||state.busy) return;
  setBusy(true); feedback('Reproducing the seeded run and preparing all trial rows…');
  try{
    const result=await post('/api/simulation/export',state.request,true);
    if(result.hash!==state.report.analysisHash)throw new Error('The source or model output changed since the displayed run. Run the simulation again before exporting.');
    download(result.blob,`cropguard-${state.report.source.synthetic?'synthetic-':''}trials.csv`);
    feedback(`Exported ${number(state.report.simulations)} simulated trial rows. These are not weather observations.`);
  }catch(e){feedback(e.message,true);}finally{setBusy(false);}
};
async function loadSavedSources() {
  if ($('sim-source').value !== 'ethiopia_archive' || state.sourcesLoading || state.busy) return;
  state.sourcesLoading = true;
  sourceControls();
  try {
    const response = await fetch('/api/weather/datasets');
    if (!response.ok) throw new Error('Saved datasets could not be loaded.');
    const result = await response.json(), selected=$('sim-snapshot').value;
    const histories = result.items.filter(r => r.complete && era5Parameters.has(r.parameter));
    $('sim-snapshot').replaceChildren(new Option('Choose a saved ERA5-Land history', ''));
    for (const r of histories) $('sim-snapshot').append(new Option(`${r.station} · ${r.parameter} · ${r.start_month} → ${r.end_month_exclusive} · ${r.snapshot_id.slice(2,10)}`,r.snapshot_id));
    if ([...$('sim-snapshot').options].some(o=>o.value===selected)) $('sim-snapshot').value=selected;
    if (!$('sim-snapshot').value) {
      const preferred = histories.find(r => r.station === 'ET_ADAMA' && r.start_month <= '1985-06' && r.end_month_exclusive >= '2025-10');
      if (preferred) $('sim-snapshot').value = preferred.snapshot_id;
    }
    if (state.report && selected !== $('sim-snapshot').value) stale();
    if (!state.report && $('sim-source').value === 'ethiopia_archive') feedback(histories.length ? 'Select the saved ERA5-Land history, review the settings, then run the simulation.' : 'Waiting for the ERA5-Land download to be imported. Select the included baseline to analyse its verified ERA5-Land history.');
  } catch(error) {
    $('sim-snapshot').replaceChildren(new Option('ERA5-Land archive could not be checked', ''));
    stale();
    if ($('sim-source').value === 'ethiopia_archive') feedback(error.message,true);
  } finally { state.sourcesLoading = false; sourceControls(); }
}
$('sim-snapshot').addEventListener('change',sourceControls);
$('sim-source').addEventListener('change',()=>{sourceControls();void loadSavedSources();});
window.addEventListener('cropguard:mode',e=>{if(e.detail.mode==='research_preview'){$('sim-source').value='bundled_era5';sourceControls();feedback('Included ERA5-Land history is ready. Review the settings, then run the simulation.');}});
$('sim-threshold-mode').addEventListener('change',()=>{
  $('sim-threshold').value = $('sim-threshold-mode').value === 'fixed' ? '297.29' : state.report?.modelFit?.tenthPercentileMm?.toFixed(3) || '170.678';
  thresholdControls();
});
$('refresh-simulation-sources').onclick=()=>void loadSavedSources();
window.addEventListener('cropguard:weather-datasets',()=>void loadSavedSources());
$('sim-stress').addEventListener('input',()=>{$('sim-stress-value').textContent=($('sim-stress').value>0?'+':'')+$('sim-stress').value+'%';});
form.addEventListener('input',stale);form.addEventListener('change',stale);
form.addEventListener('submit',e=>{e.preventDefault();void run();});
$('reset-simulation').onclick=()=>{form.reset();$('sim-stress-value').textContent='0%';sourceControls();stale();void loadSavedSources();};
const tabs=Array.from(document.querySelectorAll('[data-chart]'));
tabs.forEach((n,i)=>{
  n.onclick=()=>selectChart(n.dataset.chart);
  n.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;selectChart(tabs[next].dataset.chart);tabs[next].focus();}};
});
window.addEventListener('cropguard:navigate',e=>{if(e.detail.page==='pricing')void loadSavedSources();});
let resizeTimer;
window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(chart,150);});
sourceControls();
if (!$('page-pricing').classList.contains('hidden')) void loadSavedSources();
